import { describe, it, expect, vi, beforeEach } from "vitest";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import Database from "better-sqlite3";
import * as schema from "@/db/schema";
import path from "path";

const MIGRATIONS_FOLDER = path.resolve(__dirname, "../../../db/migrations");

function createDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db;
}

type Db = ReturnType<typeof createDb>;

vi.mock("@/db/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/db/client")>();
  return { ...original, getDb: vi.fn() };
});

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

  const profile = db
    .insert(schema.familyProfiles)
    .values({
      adultCount: 2,
      children: [{ age: 5 }],
      dietaryTags: [],
      accessibilityTags: [],
      pacingWindows: [],
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

  const trip = db
    .insert(schema.trips)
    .values({
      familyProfileId: profile.id,
      destinationId: dest.id,
      selectedNeighborhoodId: neighborhood.id,
      startDate: "2026-09-01",
      endDate: "2026-09-04",
      status: "Discovery",
    })
    .returning()
    .all()[0]!;

  return { dest, profile, neighborhood, trip };
}

async function callPost(tripId: number) {
  const { POST } = await import("./route");
  const req = new Request("http://localhost/api/discovery", {
    method: "POST",
    body: JSON.stringify({ tripId }),
    headers: { "Content-Type": "application/json" },
  });
  return POST(req);
}

describe("POST /api/discovery", () => {
  let db: Db;

  beforeEach(async () => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "test-key");
    db = createDb();
    const { getDb } = await import("@/db/client");
    vi.mocked(getDb).mockReturnValue(
      db as ReturnType<typeof import("@/db/client").getDb>
    );
  });

  it("happy path: returns results with corroborationScore >= 1 from Text Search", async () => {
    const { trip } = seedWorld(db);

    // Sequence: eatTextSearch, eat1Details, eat2Details, visitTextSearch, visit1Details
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeTextSearchResponse([
        makeTextSearchResult({ place_id: "ChIJ_eat1", name: "Musashino Ramen", types: ["restaurant"] }),
        makeTextSearchResult({ place_id: "ChIJ_eat2", name: "Kichijoji Curry", types: ["restaurant"] }),
      ]))
      .mockResolvedValueOnce(makeDetailsResponse({
        child_friendly: true,
        opening_hours: { periods: [{ open: { time: "1100" } }] },
      }))
      .mockResolvedValueOnce(makeDetailsResponse({}))
      .mockResolvedValueOnce(makeTextSearchResponse([
        makeTextSearchResult({ place_id: "ChIJ_visit1", name: "Inokashira Park", types: ["park"] }),
      ]))
      .mockResolvedValueOnce(makeDetailsResponse({}));

    const res = await callPost(trip.id);
    expect(res.status).toBe(200);

    const json = await res.json() as {
      neighborhoodId: number;
      neighborhoodName: string;
      results: Array<{ placeId: string; corroborationScore: number; goodForChildren: boolean | null }>;
      wgAvailable: boolean;
    };

    expect(json.neighborhoodName).toBe("Kichijoji");
    expect(json.wgAvailable).toBe(false);
    expect(json.results.length).toBeGreaterThan(0);

    const eat1 = json.results.find((r) => r.placeId === "ChIJ_eat1");
    expect(eat1).toBeDefined();
    expect(eat1!.corroborationScore).toBeGreaterThanOrEqual(1);
    expect(eat1!.goodForChildren).toBe(true);
  });

  it("missing API key: Text Search returns [], falls back to empty DB", async () => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "");
    const { trip } = seedWorld(db);

    const fetchSpy = vi.fn();
    global.fetch = fetchSpy;

    const res = await callPost(trip.id);
    expect(res.status).toBe(200);

    const json = await res.json() as { results: unknown[] };
    expect(json.results).toHaveLength(0);
    // textSearchPlaces returns [] without calling fetch when no API key
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("Text Search API 500: gracefully falls back to empty DB", async () => {
    const { trip } = seedWorld(db);

    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 500 } as Response) // eat textSearch fails
      .mockResolvedValueOnce({ ok: false, status: 500 } as Response); // visit textSearch fails

    const res = await callPost(trip.id);
    expect(res.status).toBe(200);

    const json = await res.json() as { results: unknown[] };
    expect(json.results).toHaveLength(0);
  });

  it("adult venue type (bar) is filtered out by filterAndRankCandidates", async () => {
    const { trip } = seedWorld(db);

    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeTextSearchResponse([
        makeTextSearchResult({ place_id: "ChIJ_bar", name: "Cool Bar", types: ["bar"] }),
        makeTextSearchResult({ place_id: "ChIJ_ramen", name: "Family Ramen", types: ["restaurant"] }),
      ]))
      // Details for bar: returns null (Details mock for this placeId can return null —
      // type-filtering runs inside filterAndRankCandidates, not in the Details path)
      .mockResolvedValueOnce({ ok: false, status: 404 } as Response)
      .mockResolvedValueOnce(makeDetailsResponse({ child_friendly: true }))
      .mockResolvedValueOnce(makeTextSearchResponse([])) // no visit results
      ;

    const res = await callPost(trip.id);
    expect(res.status).toBe(200);

    const json = await res.json() as { results: Array<{ placeId: string }> };
    const placeIds = json.results.map((r) => r.placeId);
    expect(placeIds).not.toContain("ChIJ_bar");
    expect(placeIds).toContain("ChIJ_ramen");
  });
});

describe("U3: WG+Tabelog integration", () => {
  let db: Db;

  beforeEach(async () => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "test-key");
    db = createDb();
    const { getDb } = await import("@/db/client");
    vi.mocked(getDb).mockReturnValue(
      db as ReturnType<typeof import("@/db/client").getDb>
    );
    // Reset WG mocks to default (unavailable) for isolation
    vi.mocked(checkAvailability).mockResolvedValue(false);
    vi.mocked(discoverGoat).mockResolvedValue({ results: [] } as never);
  });

  it("AE1: Google result gets tabelog source when WG returns it with tabelog in sources", async () => {
    const { trip } = seedWorld(db);
    vi.mocked(checkAvailability).mockResolvedValue(true);
    // WG returns "Ramen Nagi" with tabelog source
    vi.mocked(discoverGoat)
      .mockResolvedValueOnce(makeWgResult([makeWgPlace({ name: "Ramen Nagi", sources: ["tabelog"] })]) as never)
      .mockResolvedValueOnce(makeWgResult([]) as never); // visit category

    // Google Text Search also returns "Ramen Nagi"
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeTextSearchResponse([
        makeTextSearchResult({ place_id: "ChIJ_ramen", name: "Ramen Nagi", types: ["restaurant"] }),
      ]))
      .mockResolvedValueOnce(makeDetailsResponse({})) // details for Ramen Nagi
      .mockResolvedValueOnce(makeTextSearchResponse([])); // visit: no results

    const res = await callPost(trip.id);
    expect(res.status).toBe(200);

    const json = await res.json() as { results: Array<{ placeId: string; sources: string[]; corroborationScore: number }> };
    const ramen = json.results.find((r) => r.placeId === "ChIJ_ramen");
    expect(ramen).toBeDefined();
    expect(ramen!.sources).toContain("google-places-text-search");
    expect(ramen!.sources).toContain("wanderlust-goat");
    expect(ramen!.sources).toContain("tabelog");
    expect(ramen!.corroborationScore).toBe(3);
  });

  it("AE2: WG+Tabelog-only place is promoted as candidate with synthetic placeId", async () => {
    const { trip } = seedWorld(db);
    vi.mocked(checkAvailability).mockResolvedValue(true);
    vi.mocked(discoverGoat)
      .mockResolvedValueOnce(makeWgResult([
        makeWgPlace({ name: "Hidden Gem", lat: 35.7001, lng: 139.5801, sources: ["tabelog"] }),
      ]) as never)
      .mockResolvedValueOnce(makeWgResult([]) as never);

    // Google Text Search does NOT return "Hidden Gem"
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeTextSearchResponse([
        makeTextSearchResult({ place_id: "ChIJ_other", name: "Other Place", types: ["restaurant"] }),
      ]))
      .mockResolvedValueOnce(makeDetailsResponse({}))
      .mockResolvedValueOnce(makeTextSearchResponse([]));

    const res = await callPost(trip.id);
    expect(res.status).toBe(200);

    const json = await res.json() as { results: Array<{ placeId: string; name: string; sources: string[]; corroborationScore: number; rating: number | null }> };
    const gem = json.results.find((r) => r.name === "Hidden Gem");
    expect(gem).toBeDefined();
    expect(gem!.placeId).toMatch(/^wg:/);
    expect(gem!.sources).toEqual(["wanderlust-goat", "tabelog"]);
    expect(gem!.corroborationScore).toBe(2);
    expect(gem!.rating).toBeNull();
  });

  it("AE3: WG place without tabelog source is NOT promoted", async () => {
    const { trip } = seedWorld(db);
    vi.mocked(checkAvailability).mockResolvedValue(true);
    vi.mocked(discoverGoat)
      .mockResolvedValueOnce(makeWgResult([
        makeWgPlace({ name: "WG Only Place", sources: ["google.places"] }),
      ]) as never)
      .mockResolvedValueOnce(makeWgResult([]) as never);

    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeTextSearchResponse([])) // Google returns nothing
      .mockResolvedValueOnce(makeTextSearchResponse([]));

    const res = await callPost(trip.id);
    expect(res.status).toBe(200);

    const json = await res.json() as { results: Array<{ name: string }> };
    expect(json.results.find((r) => r.name === "WG Only Place")).toBeUndefined();
  });

  it("repeat discovery run: WG+Tabelog synthetic placeId triggers onConflictDoUpdate, no duplicate rows", async () => {
    const { trip } = seedWorld(db);
    vi.mocked(checkAvailability).mockResolvedValue(true);

    const wgResult = makeWgResult([
      makeWgPlace({ name: "Hidden Gem", lat: 35.7001, lng: 139.5801, sources: ["tabelog"] }),
    ]);

    vi.mocked(discoverGoat)
      .mockResolvedValue(wgResult as never);

    global.fetch = vi.fn()
      .mockResolvedValue(makeTextSearchResponse([])); // Google always returns nothing

    await callPost(trip.id);
    await callPost(trip.id);

    // Only one row should exist in DB for the synthetic placeId
    const { places: placesTable } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const rows = db.select().from(placesTable).where(eq(placesTable.name, "Hidden Gem")).all();
    expect(rows.length).toBe(1);
    expect(rows[0]!.placeId).toMatch(/^wg:/);
  });

  it("AE4: WG unavailable — wgAvailable false, no promotion", async () => {
    const { trip } = seedWorld(db);
    vi.mocked(checkAvailability).mockResolvedValue(false);

    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeTextSearchResponse([
        makeTextSearchResult({ place_id: "ChIJ_eat1", name: "Normal Place", types: ["restaurant"] }),
      ]))
      .mockResolvedValueOnce(makeDetailsResponse({}))
      .mockResolvedValueOnce(makeTextSearchResponse([]));

    const res = await callPost(trip.id);
    const json = await res.json() as { wgAvailable: boolean; results: Array<{ placeId: string }> };

    expect(json.wgAvailable).toBe(false);
    expect(json.results.find((r) => r.placeId.startsWith("wg:"))).toBeUndefined();
  });

  it("partial WG failure: discoverGoat throws for eat, succeeds for visit — wgAvailable true, eat has no WG signal", async () => {
    const { trip } = seedWorld(db);
    vi.mocked(checkAvailability).mockResolvedValue(true);

    // eat: throws; visit: succeeds with a tabelog candidate
    vi.mocked(discoverGoat)
      .mockRejectedValueOnce(new Error("WG timeout"))
      .mockResolvedValueOnce(makeWgResult([
        makeWgPlace({ name: "Park Cafe", lat: 35.7002, lng: 139.5802, sources: ["tabelog"] }),
      ]) as never);

    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeTextSearchResponse([
        makeTextSearchResult({ place_id: "ChIJ_eat1", name: "Eat Place", types: ["restaurant"] }),
      ]))
      .mockResolvedValueOnce(makeDetailsResponse({})) // details for eat place
      .mockResolvedValueOnce(makeTextSearchResponse([])); // visit text search: nothing from Google

    const res = await callPost(trip.id);
    expect(res.status).toBe(200);

    const json = await res.json() as {
      wgAvailable: boolean;
      results: Array<{ placeId: string; name: string; sources: string[] }>;
    };

    // wgDiscoverSucceeded set true on visit success despite eat failure
    expect(json.wgAvailable).toBe(true);

    // eat result has no WG corroboration (WG threw for eat category)
    const eatPlace = json.results.find((r) => r.name === "Eat Place");
    expect(eatPlace).toBeDefined();
    expect(eatPlace!.sources).toEqual(["google-places-text-search"]);

    // Park Cafe promoted via visit WG+Tabelog path
    const parkCafe = json.results.find((r) => r.name === "Park Cafe");
    expect(parkCafe).toBeDefined();
    expect(parkCafe!.placeId).toMatch(/^wg:/);
    expect(parkCafe!.sources).toEqual(["wanderlust-goat", "tabelog"]);
  });
});
