// Shared place-research logic (plan 2026-08-20-011 U6).
//
// Extracted, behavior-preserved, from src/app/api/discovery/route.ts's
// former inline per-category loop (Google Places Text Search + Details
// enrichment, Wanderlust-Goat corroboration/Tabelog-candidate promotion,
// dedup, incremental onConflictDoUpdate upsert, DB fallback when a
// category's enrichment produces nothing) so both the existing synchronous
// /api/discovery route and the new streamed per-neighborhood SSE route
// (src/app/api/neighborhoods/[id]/research/route.ts) share one
// implementation instead of duplicating it.
//
// Behavior is identical to the pre-extraction inline code for every step —
// only the control flow changed, from "build one big `candidates` array,
// return it once" to "yield each category's finalized candidates as soon as
// that category's work resolves." This is what gives the streamed SSE route
// its "already-resolved places are kept and streamed" partial-failure
// behavior for free: because a `for await` consumer receives each yielded
// candidate immediately, a failure thrown partway through this generator
// (e.g. a Google category's Details/upsert step throwing, per this plan's
// Key Technical Decision on degrading gracefully) can never retroactively
// erase candidates the consumer already received and persisted — unlike the
// synchronous route's original all-or-nothing single JSON response, where
// any exception anywhere in the request handler discards the entire
// response even though earlier DB writes already committed.
import { getDb } from "@/db/client";
import { places } from "@/db/schema";
import type { Destination, Neighborhood, Place } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { textSearchPlaces, getPlaceDetails } from "@/services/discovery/places";
import { buildSources, corroborationScore, namesMatch } from "@/services/discovery/corroboration";
import {
  annotateDistances,
  isWorthTheDetour,
  type DiscoveryCandidate,
} from "@/services/discovery/filters";
import { discoverGoat, checkAvailability } from "@/services/wanderlust-goat/client";
import { WGPlace, WGUnavailableError } from "@/services/wanderlust-goat/types";
import { withConcurrencyLimit } from "@/services/research/concurrency";

type Db = ReturnType<typeof getDb>;

// ---------------------------------------------------------------------------
// Cross-category accumulators
// ---------------------------------------------------------------------------
//
// The original inline logic tracked two things in closure variables spanning
// both categories: `openingHoursMap` (needed by filterAndRankCandidates,
// which the synchronous route still owns) and `wgDiscoverSucceeded` (the
// `wgAvailable` flag in the synchronous route's JSON response). An async
// generator has exactly one output channel (its yielded values), so these
// two aggregates are threaded through as a mutable object passed in by the
// caller instead — the streamed SSE route doesn't need either of them today,
// but the synchronous route does, and this keeps the generator's single
// yield channel reserved for the thing both callers actually want streamed:
// individual DiscoveryCandidates.
export interface ResearchAccumulators {
  openingHoursMap: Map<string, Array<{ startTime: string }>>;
  wgDiscoverSucceeded: boolean;
}

export function createResearchAccumulators(): ResearchAccumulators {
  return { openingHoursMap: new Map(), wgDiscoverSucceeded: false };
}

// Converts a persisted `places` row back into the in-memory candidate shape
// used by both callers (distanceFromCentroidMeters/worthTheDetour still
// need computing against a neighborhood — see finalizeDistances below;
// photoReference is never persisted, matching the original DB-fallback
// path's behavior of always returning null for it).
export function placeRowToCandidateBase(
  p: Place
): Omit<DiscoveryCandidate, "distanceFromCentroidMeters" | "worthTheDetour"> {
  return {
    placeId: p.placeId,
    name: p.name,
    category: p.category as "eat" | "visit",
    lat: p.lat,
    lng: p.lng,
    rating: p.rating,
    reviewCount: p.reviewCount,
    priceLevel: p.priceLevel,
    types: p.types as string[],
    goodForChildren: p.goodForChildren,
    menuForChildren: p.menuForChildren,
    sources: p.sources as string[],
    corroborationScore: p.corroborationScore,
    photoReference: null,
    description: p.description ?? null,
  };
}

// Computes distanceFromCentroidMeters and worthTheDetour for a batch of
// candidates against a neighborhood — the same two-step
// annotateDistances-then-isWorthTheDetour sequence the original inline code
// ran per category, extracted so both the live-research path (below) and a
// cached-path caller (the SSE route, rendering already-persisted rows) can
// reuse it identically instead of recomputing the formula separately.
export function finalizeDistances(
  candidates: Omit<DiscoveryCandidate, "distanceFromCentroidMeters" | "worthTheDetour">[],
  neighborhood: Pick<Neighborhood, "centroidLat" | "centroidLng" | "walkingRadiusMeters">
): DiscoveryCandidate[] {
  const withDistances = annotateDistances(
    candidates.map((c) => ({ ...c, worthTheDetour: false })),
    neighborhood
  );
  for (const candidate of withDistances) {
    candidate.worthTheDetour =
      candidate.distanceFromCentroidMeters > neighborhood.walkingRadiusMeters &&
      isWorthTheDetour(candidate);
  }
  return withDistances;
}

// Runs Google Places + Wanderlust-Goat research for one neighborhood, across
// both "eat" and "visit" categories, persisting each place via the existing
// onConflictDoUpdate upsert as it resolves and yielding the finalized
// DiscoveryCandidate for it. Categories are processed in order (eat, then
// visit) and each category's candidates are yielded together once that
// category's enrichment/promotion/fallback work resolves — identical
// ordering to the original code's `candidates.push(...withDistances)` per
// category, just delivered incrementally instead of accumulated into one
// array before returning.
export async function* researchNeighborhoodPlaces(
  db: Db,
  neighborhood: Neighborhood,
  destination: Destination,
  acc: ResearchAccumulators = createResearchAccumulators()
): AsyncGenerator<DiscoveryCandidate> {
  const categories: Array<"eat" | "visit"> = ["eat", "visit"];

  const wgInstalled = await checkAvailability();

  for (const category of categories) {
    // Stage 1: Google Places Text Search — structured place objects directly
    const textSearchResults = await textSearchPlaces(neighborhood.name, category, destination.name);

    // Stage 1b: WG CLI — corroboration signal + Tabelog-confirmed candidate promotion
    const wgNames: string[] = [];
    const tabelogNames: string[] = [];
    const wgTabelogCandidates: WGPlace[] = [];
    if (wgInstalled) {
      try {
        const wgResult = await discoverGoat(
          neighborhood.name,
          category,
          neighborhood.walkingRadiusMeters,
          destination.name,
          destination.country
        );
        acc.wgDiscoverSucceeded = true;
        for (const place of wgResult.results) {
          wgNames.push(place.name);
          if (place.sources.includes("tabelog")) {
            tabelogNames.push(place.name);
            wgTabelogCandidates.push(place);
          }
        }
      } catch (err) {
        if (!(err instanceof WGUnavailableError)) {
          console.warn(
            "[Discovery] WG error:",
            err instanceof Error ? err.message : err
          );
        }
      }
    }

    // Dedup by placeId (Text Search can occasionally return duplicates)
    const seen = new Set<string>();
    const deduped = textSearchResults.filter((r) => {
      if (seen.has(r.placeId)) return false;
      seen.add(r.placeId);
      return true;
    });

    // Stage 2: Place Details enrichment (concurrency-limited, 8 parallel)
    const enriched: DiscoveryCandidate[] = [];

    await withConcurrencyLimit(
      deduped,
      async (place) => {
        const details = await getPlaceDetails(place.placeId);
        const sources = buildSources(place.name, wgNames, tabelogNames);
        const score = corroborationScore(sources);
        const hours = details?.openingHours ?? [];

        acc.openingHoursMap.set(place.placeId, hours);

        // Not wrapped in try/catch, matching the original inline code — a
        // failure here (e.g. a malformed place with a missing lat/lng, or a
        // genuine DB-layer error) is intentionally allowed to propagate.
        // Under the OLD synchronous route this meant losing the entire
        // response even though earlier categories' places had already
        // committed to the DB; under the NEW streamed route (see
        // src/app/api/neighborhoods/[id]/research/route.ts's runResearch)
        // it means everything already yielded before this point stays kept
        // and streamed, and only the remainder of the run is marked
        // "partial" — the behavior change this unit's KTD calls for, without
        // needing to touch this per-place logic at all.
        const upsertRows = db
          .insert(places)
          .values({
            neighborhoodId: neighborhood.id,
            placeId: place.placeId,
            name: place.name,
            category,
            lat: place.lat,
            lng: place.lng,
            rating: place.rating,
            reviewCount: place.reviewCount,
            priceLevel: place.priceLevel,
            types: place.types,
            goodForChildren: details?.goodForChildren ?? null,
            menuForChildren: details?.menuForChildren ?? null,
            sources,
            corroborationScore: score,
            openingHours: hours,
            enrichedAt: new Date(),
            description: details?.description ?? null,
          })
          .onConflictDoUpdate({
            target: [places.placeId, places.neighborhoodId],
            set: {
              rating: place.rating,
              reviewCount: place.reviewCount,
              priceLevel: place.priceLevel,
              sources,
              corroborationScore: score,
              openingHours: hours,
              enrichedAt: new Date(),
              description: sql`excluded.description`,
            },
          })
          .returning()
          .all();

        if (!upsertRows[0]) return;

        enriched.push({
          placeId: place.placeId,
          name: place.name,
          category,
          lat: place.lat,
          lng: place.lng,
          rating: place.rating,
          reviewCount: place.reviewCount,
          priceLevel: place.priceLevel,
          types: place.types,
          goodForChildren: details?.goodForChildren ?? null,
          menuForChildren: details?.menuForChildren ?? null,
          sources,
          corroborationScore: score,
          distanceFromCentroidMeters: 0,
          worthTheDetour: false,
          photoReference: place.photoReference ?? null,
          description: details?.description ?? null,
        });
      },
      8
    );

    // Promote WG+Tabelog candidates with no Google match (inside category loop, before DB fallback)
    const enrichedNames = enriched.map((e) => e.name);
    for (const wgPlace of wgTabelogCandidates) {
      if (enrichedNames.some((n) => namesMatch(n, wgPlace.name))) continue;
      const syntheticPlaceId = `wg:${wgPlace.lat.toFixed(6)},${wgPlace.lng.toFixed(6)}`;
      const promotedSources = ["wanderlust-goat", "tabelog"];
      const promotedScore = corroborationScore(promotedSources);

      db.insert(places)
        .values({
          placeId: syntheticPlaceId,
          neighborhoodId: neighborhood.id,
          name: wgPlace.name,
          category,
          lat: wgPlace.lat,
          lng: wgPlace.lng,
          rating: null,
          reviewCount: null,
          priceLevel: null,
          types: [],
          goodForChildren: null,
          menuForChildren: null,
          openingHours: [],
          sources: promotedSources,
          corroborationScore: promotedScore,
          enrichedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [places.placeId, places.neighborhoodId],
          set: {
            sources: promotedSources,
            corroborationScore: promotedScore,
            enrichedAt: new Date(),
          },
        })
        .returning()
        .all();

      acc.openingHoursMap.set(syntheticPlaceId, []);

      enriched.push({
        placeId: syntheticPlaceId,
        name: wgPlace.name,
        category,
        lat: wgPlace.lat,
        lng: wgPlace.lng,
        rating: null,
        reviewCount: null,
        priceLevel: null,
        types: [],
        goodForChildren: null,
        menuForChildren: null,
        sources: promotedSources,
        corroborationScore: promotedScore,
        distanceFromCentroidMeters: 0,
        worthTheDetour: false,
        photoReference: null,
        description: null,
      });
    }

    if (enriched.length === 0) {
      // DB fallback: load cached places and restore openingHoursMap from stored data
      const dbCategoryPlaces = db
        .select()
        .from(places)
        .where(eq(places.neighborhoodId, neighborhood.id))
        .all()
        .filter((p) => p.category === category);

      for (const p of dbCategoryPlaces) {
        const storedHours = (p.openingHours as Array<{ startTime: string }>) ?? [];
        acc.openingHoursMap.set(p.placeId, storedHours);
        enriched.push({
          ...placeRowToCandidateBase(p),
          distanceFromCentroidMeters: 0,
          worthTheDetour: false,
        });
      }
    }

    const finalized = finalizeDistances(enriched, neighborhood);

    for (const candidate of finalized) {
      yield candidate;
    }
  }
}
