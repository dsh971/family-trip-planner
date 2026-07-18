import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { neighborhoods, safetyAreas, places, trips, familyProfiles } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { textSearchPlaces, getPlaceDetails } from "@/services/discovery/places";
import { buildSources, corroborationScore } from "@/services/discovery/corroboration";
import {
  filterAndRankCandidates,
  annotateDistances,
  isWorthTheDetour,
  type DiscoveryCandidate,
} from "@/services/discovery/filters";
import {
  discoverGoat,
  checkAvailability,
} from "@/services/wanderlust-goat/client";
import { WGUnavailableError } from "@/services/wanderlust-goat/types";

// Concurrency-limited batch processor
async function withConcurrencyLimit<T>(
  items: T[],
  fn: (item: T) => Promise<unknown>,
  limit: number
): Promise<void> {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += limit) {
    chunks.push(items.slice(i, i + limit));
  }
  for (const chunk of chunks) {
    await Promise.all(chunk.map(fn));
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { tripId } = body as { tripId?: number };
  if (!tripId) {
    return NextResponse.json({ error: "tripId required" }, { status: 400 });
  }

  const db = getDb();

  const trip = db.select().from(trips).where(eq(trips.id, tripId)).all()[0];
  if (!trip || !trip.selectedNeighborhoodId) {
    return NextResponse.json(
      { error: "Trip not found or no neighborhood selected" },
      { status: 404 }
    );
  }

  const neighborhood = db
    .select()
    .from(neighborhoods)
    .where(eq(neighborhoods.id, trip.selectedNeighborhoodId))
    .all()[0];
  if (!neighborhood) {
    return NextResponse.json({ error: "Neighborhood not found" }, { status: 404 });
  }

  const sas = db
    .select()
    .from(safetyAreas)
    .where(eq(safetyAreas.destinationId, trip.destinationId))
    .all();

  const categories: Array<"eat" | "visit"> = ["eat", "visit"];
  const candidates: DiscoveryCandidate[] = [];

  // Declared before the loop so both categories accumulate into one shared map
  const openingHoursMap = new Map<string, Array<{ startTime: string }>>();

  const wgInstalled = await checkAvailability();
  let wgDiscoverSucceeded = false;

  for (const category of categories) {
    // Stage 1: Google Places Text Search — structured place objects directly
    const textSearchResults = await textSearchPlaces(neighborhood.name, category);

    // Stage 1b: WG CLI — corroboration signal only (WG-only places not added as candidates)
    const wgNames: string[] = [];
    if (wgInstalled) {
      try {
        const wgResult = await discoverGoat(
          neighborhood.name,
          category,
          neighborhood.walkingRadiusMeters
        );
        wgDiscoverSucceeded = true;
        for (const place of wgResult.results) {
          wgNames.push(place.name);
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
        const sources = buildSources(place.name, wgNames);
        const score = corroborationScore(sources);
        const hours = details?.openingHours ?? [];

        openingHoursMap.set(place.placeId, hours);

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
            photoReference: details?.photoReference ?? null,
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
              photoReference: sql`excluded.photo_reference`,
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
          photoReference: details?.photoReference ?? null,
          description: details?.description ?? null,
        });
      },
      8
    );

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
        openingHoursMap.set(p.placeId, storedHours);
        enriched.push({
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
          distanceFromCentroidMeters: 0,
          worthTheDetour: false,
          photoReference: p.photoReference ?? null,
          description: p.description ?? null,
        });
      }
    }

    const withDistances = annotateDistances(enriched, neighborhood);

    for (const candidate of withDistances) {
      candidate.worthTheDetour =
        candidate.distanceFromCentroidMeters > neighborhood.walkingRadiusMeters &&
        isWorthTheDetour(candidate);
    }

    candidates.push(...withDistances);
  }

  const profile = db
    .select()
    .from(familyProfiles)
    .where(eq(familyProfiles.id, trip.familyProfileId))
    .all()[0];

  const filtered = filterAndRankCandidates(
    candidates,
    profile ?? { dietaryTags: [], accessibilityTags: [], pacingWindows: [] },
    sas,
    openingHoursMap
  );

  return NextResponse.json({
    neighborhoodId: neighborhood.id,
    neighborhoodName: neighborhood.name,
    results: filtered,
    wgAvailable: wgDiscoverSucceeded,
  });
}
