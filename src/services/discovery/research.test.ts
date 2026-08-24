// Unit/integration coverage for src/services/discovery/research.ts, added
// for plan 2026-08-23-002 U3 (place-photo pipeline fix). Exercises
// researchNeighborhoodPlaces + placeRowToCandidateBase directly against an
// in-memory SQLite DB, complementing the higher-level coverage in
// src/app/api/discovery/route.test.ts (which asserts photoReference on the
// live-research in-memory candidate but never on a DB-rehydration read —
// the actual gap this unit closes).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import path from "path";
import {
  researchNeighborhoodPlaces,
  placeRowToCandidateBase,
  createResearchAccumulators,
  finalizeDistances,
} from "@/services/discovery/research";

const MIGRATIONS_FOLDER = path.resolve(__dirname, "../../db/migrations");

function createDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db;
}

type Db = ReturnType<typeof createDb>;

vi.mock("@/services/wanderlust-goat/client", () => ({
  checkAvailability: vi.fn().mockResolvedValue(false),
  discoverGoat: vi.fn().mockResolvedValue({ results: [] }),
}));

import type { WGPlace } from "@/services/wanderlust-goat/types";
import { checkAvailability, discoverGoat } from "@/services/wanderlust-goat/client";

function makeWgPlace(overrides: Partial<WGPlace> = {}): WGPlace {
  return {
    name: overrides.name ?? "Test WG Place",
    lat: overrides.lat ?? 35.703,
    lng: overrides.lng ?? 139.581,
    address: "Tokyo, Japan",
    walking_minutes: 5,
    score: { total: 75, google_base: 60, locale_boost: 15, notability_boost: 0, reddit_boost: 0, criteria_match: 0 },
    sources: overrides.sources ?? [],
    evidence: null,
    why: "",
    business_status: "OPERATIONAL",
    google_maps_uri: "https://maps.google.com/?cid=123",
  };
}

function makeWgResult(wgPlaces: WGPlace[]) {
  return {
    anchor: { query: "Kichijoji, Tokyo, Japan", lat: 35.702, lng: 139.580, country: "JP", display: "Kichijoji", city: "Kichijoji" },
    results: wgPlaces,
    trace: { Region: "JP", SeedCount: 10, StageHits: wgPlaces.length, StubsSkipped: [], Errors: [] },
  };
}

function makeTextSearchResult(overrides: Partial<{
  place_id: string; name: string; lat: number; lng: number;
  rating: number; user_ratings_total: number; price_level: number; types: string[];
  photo_reference: string;
}> = {}) {
  return {
    place_id: overrides.place_id ?? "ChIJ_default",
    name: overrides.name ?? "Test Place",
    geometry: {
      location: {
        lat: overrides.lat ?? 35.702,
        lng: overrides.lng ?? 139.580,
      },
    },
    rating: overrides.rating ?? 4.0,
    user_ratings_total: overrides.user_ratings_total ?? 200,
    price_level: overrides.price_level ?? 2,
    types: overrides.types ?? ["restaurant"],
    ...(overrides.photo_reference ? { photos: [{ photo_reference: overrides.photo_reference }] } : {}),
  };
}

function makeTextSearchResponse(items: ReturnType<typeof makeTextSearchResult>[]) {
  return {
    ok: true,
    json: async () => ({ status: "OK", results: items }),
  } as Response;
}

function makeDetailsResponse(result: Record<string, unknown>) {
  return {
    ok: true,
    json: async () => ({ status: "OK", result }),
  } as Response;
}

function seedWorld(db: Db) {
  const dest = db
    .insert(schema.destinations)
    .values({
      slug: "tokyo",
      name: "Tokyo",
      country: "JP",
      defaultWalkingRadiusMeters: 1200,
      localeValidators: [],
      safetyDataSource: "OSAC 2024",
    })
    .returning()
    .all()[0]!;

  const neighborhood = db
    .insert(schema.neighborhoods)
    .values({
      destinationId: dest.id,
      name: "Kichijoji",
      centroidLat: 35.702,
      centroidLng: 139.580,
      walkingRadiusMeters: 800,
      familyFriendlinessScore: 90,
      dayInTheLifePreview: {
        highlights: ["Inokashira Park"],
        safetyNote: "Very safe",
        sampleBundle: "Park → lunch → shopping",
      },
      sources: ["timeout-tokyo"],
    })
    .returning()
    .all()[0]!;

  return { dest, neighborhood };
}

// Drains the async generator into a flat array, mirroring how both API
// route callers (sync /api/discovery, streamed SSE) consume it.
async function drain(
  gen: AsyncGenerator<import("@/services/discovery/filters").DiscoveryCandidate>
) {
  const out: import("@/services/discovery/filters").DiscoveryCandidate[] = [];
  for await (const candidate of gen) out.push(candidate);
  return out;
}

describe("researchNeighborhoodPlaces / placeRowToCandidateBase — photo pipeline", () => {
  let db: Db;

  beforeEach(() => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "test-key");
    db = createDb();
    vi.mocked(checkAvailability).mockResolvedValue(false);
    vi.mocked(discoverGoat).mockResolvedValue(makeWgResult([]));
  });

  it("happy path: a fresh Google Places photo_reference is persisted and a subsequent DB-rehydration read returns the same non-null photoReference", async () => {
    const { dest, neighborhood } = seedWorld(db);

    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeTextSearchResponse([
        makeTextSearchResult({ place_id: "ChIJ_photo1", name: "Photo Place", photo_reference: "ref-abc-123" }),
      ]))
      .mockResolvedValueOnce(makeDetailsResponse({}))
      .mockResolvedValueOnce(makeTextSearchResponse([])); // visit category: no results

    const liveCandidates = await drain(
      researchNeighborhoodPlaces(db, neighborhood, dest, createResearchAccumulators())
    );
    const live = liveCandidates.find((c) => c.placeId === "ChIJ_photo1");
    expect(live).toBeDefined();
    expect(live!.photoReference).toBe("ref-abc-123");

    // Second visit: rehydrate straight from the persisted row, as the
    // cache-aware fast path and the SSE route's cached rendering do.
    const row = db.select().from(schema.places)
      .where(eq(schema.places.placeId, "ChIJ_photo1"))
      .all()[0];
    expect(row).toBeDefined();
    expect(row!.photoReference).toBe("ref-abc-123");

    const rehydrated = placeRowToCandidateBase(row!);
    expect(rehydrated.photoReference).toBe("ref-abc-123");
  });

  it("edge case: no photos array in the Google API response persists and rehydrates with photoReference: null (no crash, no fabricated value)", async () => {
    const { dest, neighborhood } = seedWorld(db);

    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeTextSearchResponse([
        makeTextSearchResult({ place_id: "ChIJ_nophoto", name: "No Photo Place" }),
      ]))
      .mockResolvedValueOnce(makeDetailsResponse({}))
      .mockResolvedValueOnce(makeTextSearchResponse([]));

    const liveCandidates = await drain(
      researchNeighborhoodPlaces(db, neighborhood, dest, createResearchAccumulators())
    );
    const live = liveCandidates.find((c) => c.placeId === "ChIJ_nophoto");
    expect(live).toBeDefined();
    expect(live!.photoReference).toBeNull();

    const row = db.select().from(schema.places)
      .where(eq(schema.places.placeId, "ChIJ_nophoto"))
      .all()[0];
    expect(row).toBeDefined();
    expect(row!.photoReference).toBeNull();

    const rehydrated = placeRowToCandidateBase(row!);
    expect(rehydrated.photoReference).toBeNull();
  });

  it("edge case: WG/Tabelog-promoted candidate (no Google match) has no photo source — persists and rehydrates with photoReference: null, no fabricated value", async () => {
    const { dest, neighborhood } = seedWorld(db);

    vi.mocked(checkAvailability).mockResolvedValue(true);
    vi.mocked(discoverGoat).mockResolvedValue(
      makeWgResult([
        makeWgPlace({ name: "Tabelog Only Spot", sources: ["tabelog"] }),
      ])
    );

    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeTextSearchResponse([])) // eat: no Google match at all
      .mockResolvedValueOnce(makeTextSearchResponse([])); // visit

    const liveCandidates = await drain(
      researchNeighborhoodPlaces(db, neighborhood, dest, createResearchAccumulators())
    );
    const promoted = liveCandidates.find((c) => c.name === "Tabelog Only Spot");
    expect(promoted).toBeDefined();
    expect(promoted!.photoReference).toBeNull();
    expect(promoted!.sources).toEqual(["wanderlust-goat", "tabelog"]);

    const row = db.select().from(schema.places)
      .where(eq(schema.places.name, "Tabelog Only Spot"))
      .all()[0];
    expect(row).toBeDefined();
    expect(row!.photoReference).toBeNull();

    const rehydrated = placeRowToCandidateBase(row!);
    expect(rehydrated.photoReference).toBeNull();
  });

  it("integration: full discovery-to-DB-to-redisplay round trip yields a photoReference resolvable by GET /api/places/photo?ref=...", async () => {
    const { dest, neighborhood } = seedWorld(db);

    // First visit: fresh research, Google Places returns a photo.
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeTextSearchResponse([
        makeTextSearchResult({ place_id: "ChIJ_roundtrip", name: "Roundtrip Place", photo_reference: "ref-roundtrip-1" }),
      ]))
      .mockResolvedValueOnce(makeDetailsResponse({}))
      .mockResolvedValueOnce(makeTextSearchResponse([]));

    await drain(researchNeighborhoodPlaces(db, neighborhood, dest, createResearchAccumulators()));

    // Second visit: no live Google calls — simulate the cache-aware fast
    // path / SSE route's cached-render branch, reading straight from the DB.
    const rows = db.select().from(schema.places)
      .where(eq(schema.places.neighborhoodId, neighborhood.id))
      .all();
    const base = rows.map(placeRowToCandidateBase);
    const finalized = finalizeDistances(base, neighborhood);

    const redisplayed = finalized.find((c) => c.placeId === "ChIJ_roundtrip");
    expect(redisplayed).toBeDefined();
    expect(redisplayed!.photoReference).toBe("ref-roundtrip-1");

    // What discovery/page.tsx's rendering path (line ~257-259) does with a
    // non-null photoReference: build the resolvable /api/places/photo URL.
    const imgSrc = `/api/places/photo?ref=${encodeURIComponent(redisplayed!.photoReference!)}&width=200`;
    expect(imgSrc).toBe("/api/places/photo?ref=ref-roundtrip-1&width=200");
  });
});
