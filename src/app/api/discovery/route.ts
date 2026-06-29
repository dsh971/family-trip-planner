import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { neighborhoods, safetyAreas, places, trips, familyProfiles } from "@/db/schema";
import { eq } from "drizzle-orm";
import { searchCandidates } from "@/services/discovery/web-search";
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

async function enrichWithGooglePlaces(name: string, address: string | null): Promise<{
  placeId: string;
  lat: number;
  lng: number;
  rating: number | null;
  reviewCount: number | null;
  priceLevel: number | null;
  types: string[];
  goodForChildren: boolean | null;
  menuForChildren: boolean | null;
  openingHours: Array<{ startTime: string }>;
} | null> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return null;

  const query = address ? `${name} ${address}` : name;
  const url = new URL("https://maps.googleapis.com/maps/api/place/findplacefromtext/json");
  url.searchParams.set("input", query);
  url.searchParams.set("inputtype", "textquery");
  url.searchParams.set("fields", "place_id,geometry,rating,user_ratings_total,price_level,types");
  url.searchParams.set("key", apiKey);

  try {
    const res = await fetch(url.toString());
    if (!res.ok) return null;

    const json = await res.json() as {
      status: string;
      candidates: Array<{
        place_id: string;
        geometry: { location: { lat: number; lng: number } };
        rating?: number;
        user_ratings_total?: number;
        price_level?: number;
        types?: string[];
      }>;
    };

    if (json.status !== "OK" || json.candidates.length === 0) return null;

    const c = json.candidates[0]!;
    return {
      placeId: c.place_id,
      lat: c.geometry.location.lat,
      lng: c.geometry.location.lng,
      rating: c.rating ?? null,
      reviewCount: c.user_ratings_total ?? null,
      priceLevel: c.price_level ?? null,
      types: c.types ?? [],
      goodForChildren: null, // requires Place Details API — skipping in Find Place
      menuForChildren: null,
      openingHours: [],
    };
  } catch {
    return null;
  }
}

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
    return NextResponse.json({ error: "Trip not found or no neighborhood selected" }, { status: 404 });
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

  const wgAvailable = await checkAvailability();

  for (const category of categories) {
    const candidatePool: Array<{ name: string; address: string | null }> = [];

    // Stage 1: Web search candidates
    const webCandidates = await searchCandidates(neighborhood.name, category);
    for (const wc of webCandidates) {
      candidatePool.push({ name: wc.name, address: wc.address });
    }

    // Stage 1b: WG goat discovery candidates
    if (wgAvailable) {
      try {
        const wgResult = await discoverGoat(neighborhood.name, category, neighborhood.walkingRadiusMeters);
        for (const place of wgResult.results) {
          candidatePool.push({ name: place.name, address: place.address });
        }
      } catch (err) {
        if (!(err instanceof WGUnavailableError)) {
          console.warn("[Discovery] WG error:", err instanceof Error ? err.message : err);
        }
      }
    }

    // Stage 2: Google Places enrichment (bounded concurrency)
    const enriched: DiscoveryCandidate[] = [];
    await withConcurrencyLimit(candidatePool, async ({ name, address }) => {
      const gp = await enrichWithGooglePlaces(name, address);
      if (!gp) return;

      // Skip if placeId already exists in the enriched pool
      if (enriched.some((e) => e.placeId === gp.placeId)) return;

      const upsertRows = db
        .insert(places)
        .values({
          neighborhoodId: neighborhood.id,
          placeId: gp.placeId,
          name,
          category,
          lat: gp.lat,
          lng: gp.lng,
          rating: gp.rating,
          reviewCount: gp.reviewCount,
          priceLevel: gp.priceLevel,
          types: gp.types,
          goodForChildren: gp.goodForChildren,
          menuForChildren: gp.menuForChildren,
          sources: ["google-places"],
          corroborationScore: 0,
          enrichedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [places.placeId, places.neighborhoodId],
          set: {
            rating: gp.rating,
            reviewCount: gp.reviewCount,
            priceLevel: gp.priceLevel,
            enrichedAt: new Date(),
          },
        })
        .returning()
        .all();

      const persisted = upsertRows[0];
      if (!persisted) return;

      enriched.push({
        placeId: gp.placeId,
        name,
        category,
        lat: gp.lat,
        lng: gp.lng,
        rating: gp.rating,
        reviewCount: gp.reviewCount,
        priceLevel: gp.priceLevel,
        types: gp.types,
        goodForChildren: gp.goodForChildren,
        menuForChildren: gp.menuForChildren,
        sources: ["google-places"],
        corroborationScore: 0,
        distanceFromCentroidMeters: 0, // computed below
        worthTheDetour: false,
      });
    }, 8);

    if (enriched.length === 0) {
      // Empty state — widen radius once (fall back to serving from DB if any exist)
      const dbPlaces = db.select().from(places).where(eq(places.neighborhoodId, neighborhood.id)).all();
      const dbCategoryPlaces = dbPlaces.filter((p) => p.category === category);
      for (const p of dbCategoryPlaces) {
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
        });
      }
    }

    // Annotate distances from neighborhood centroid
    const withDistances = annotateDistances(enriched, neighborhood);

    // Mark "worth the detour" for out-of-radius places
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

  const filtered = filterAndRankCandidates(candidates, profile ?? {
    dietaryTags: [],
    accessibilityTags: [],
    pacingWindows: [],
  }, sas);

  return NextResponse.json({
    neighborhoodId: neighborhood.id,
    neighborhoodName: neighborhood.name,
    results: filtered,
    wgAvailable,
  });
}
