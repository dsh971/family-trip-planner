import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { neighborhoods, safetyAreas, trips, familyProfiles, destinations, places } from "@/db/schema";
import { eq } from "drizzle-orm";
import { findNearbyTransitStations } from "@/services/discovery/places";
import { filterAndRankCandidates, type DiscoveryCandidate } from "@/services/discovery/filters";
// The Google Places + Wanderlust-Goat research logic (Text Search, Details
// enrichment, WG corroboration/Tabelog promotion, dedup, incremental upsert)
// moved to this shared module (plan 2026-08-20-011 U6) so the new streamed
// per-neighborhood SSE route
// (src/app/api/neighborhoods/[id]/research/route.ts) can reuse it instead of
// duplicating it. Behavior here is unchanged — this route just drains the
// generator into an array where it used to build that array inline.
import {
  researchNeighborhoodPlaces,
  createResearchAccumulators,
  placeRowToCandidateBase,
  finalizeDistances,
} from "@/services/discovery/research";
import { isStale } from "@/services/research/orchestrator";
import { checkAvailability } from "@/services/wanderlust-goat/client";

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

  // Real destination (city/country) for this trip — threaded into textSearchPlaces
  // and discoverGoat instead of their old hardcoded Tokyo/Japan defaults (plan
  // 2026-08-20-011 U2).
  const destination = db
    .select()
    .from(destinations)
    .where(eq(destinations.id, trip.destinationId))
    .all()[0];
  if (!destination) {
    return NextResponse.json({ error: "Destination not found" }, { status: 404 });
  }

  // Cache-aware fast path (plan 2026-08-20-011 U7): a neighborhood already
  // researched via the U6 SSE route (complete OR partial, not stale) is
  // read straight from the DB instead of re-running the full Google Places
  // + Wanderlust-Goat pass again here — mirrors the exact cached-path
  // pattern src/app/api/neighborhoods/[id]/research/route.ts already uses.
  // Without this, every visit to the Discovery page would re-pay the
  // external API cost the SSE research run already just paid, even though
  // the U6 route just persisted this neighborhood's places.
  //
  // Code review finding (2026-08-21): this originally checked only
  // "complete", excluding "partial" — but the Discovery page always calls
  // this route once the SSE stream settles to either terminal status
  // (src/app/trip/[tripId]/discovery/page.tsx), and this branch never calls
  // markComplete/markPartial itself, so a partial run's neighborhood stayed
  // "partial" forever and re-paid full external API cost on every single
  // visit. "Partial" already means "whatever resolved was persisted" (see
  // the SSE route's runResearch), so reading it back here is exactly as
  // safe as the "complete" case — just a shorter list. Only not_started,
  // in_progress, or stale neighborhoods still take the live research path
  // below.
  let candidates: DiscoveryCandidate[];
  let openingHoursMap: Map<string, Array<{ startTime: string }>>;
  let wgDiscoverSucceeded: boolean;

  if (
    (neighborhood.researchStatus === "complete" || neighborhood.researchStatus === "partial") &&
    !isStale(neighborhood.researchedAt)
  ) {
    const existing = db.select().from(places).where(eq(places.neighborhoodId, neighborhood.id)).all();
    candidates = finalizeDistances(existing.map(placeRowToCandidateBase), neighborhood);
    openingHoursMap = new Map(
      existing.map((p) => [p.placeId, (p.openingHours as Array<{ startTime: string }>) ?? []])
    );
    wgDiscoverSucceeded = await checkAvailability();
  } else {
    const acc = createResearchAccumulators();
    candidates = [];
    for await (const candidate of researchNeighborhoodPlaces(db, neighborhood, destination, acc)) {
      candidates.push(candidate);
    }
    openingHoursMap = acc.openingHoursMap;
    wgDiscoverSucceeded = acc.wgDiscoverSucceeded;
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

  const transitStations = await findNearbyTransitStations(
    neighborhood.centroidLat,
    neighborhood.centroidLng
  );

  return NextResponse.json({
    neighborhoodId: neighborhood.id,
    neighborhoodName: neighborhood.name,
    results: filtered,
    wgAvailable: wgDiscoverSucceeded,
    lodgingLat: trip.lodgingAnchorLat ?? null,
    lodgingLng: trip.lodgingAnchorLng ?? null,
    transitStations,
  });
}
