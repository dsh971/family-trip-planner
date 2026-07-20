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

  it("photoReference from text search is passed through in API results", async () => {
    const { trip } = seedWorld(db);

    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeTextSearchResponse([
        makeTextSearchResult({ place_id: "ChIJ_photo1", name: "Photo Place", types: ["restaurant"], photo_reference: "ref-abc-123" }),
      ]))
      .mockResolvedValueOnce(makeDetailsResponse({}))
      .mockResolvedValueOnce(makeTextSearchResponse([]));

    const res = await callPost(trip.id);
    expect(res.status).toBe(200);

    const json = await res.json() as {
      results: Array<{ placeId: string; photoReference: string | null }>;
    };
    const place = json.results.find((r) => r.placeId === "ChIJ_photo1");
    expect(place).toBeDefined();
    expect(place!.photoReference).toBe("ref-abc-123");
  });

  it("description from editorial_summary is returned in API results", async () => {
    const { trip } = seedWorld(db);

    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeTextSearchResponse([
        makeTextSearchResult({ place_id: "ChIJ_desc1", name: "Described Place", types: ["restaurant"] }),
      ]))
      .mockResolvedValueOnce(makeDetailsResponse({
        editorial_summary: { overview: "A lovely family spot in Kichijoji." },
      }))
      .mockResolvedValueOnce(makeTextSearchResponse([])); // no visit results

    const res = await callPost(trip.id);
    expect(res.status).toBe(200);

    const json = await res.json() as {
      results: Array<{ placeId: string; description: string | null }>;
    };
    const place = json.results.find((r) => r.placeId === "ChIJ_desc1");
    expect(place).toBeDefined();
    expect(place!.description).toBe("A lovely family spot in Kichijoji.");
  });

  it("place with no photo in text search has photoReference: null and description: null when details fail", async () => {
    const { trip } = seedWorld(db);

    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeTextSearchResponse([
        makeTextSearchResult({ place_id: "ChIJ_nodetails", name: "No Details Place", types: ["restaurant"] }),
      ]))
      .mockResolvedValueOnce({ ok: false, status: 404 } as Response) // details returns null
      .mockResolvedValueOnce(makeTextSearchResponse([]));

    const res = await callPost(trip.id);
    expect(res.status).toBe(200);

    const json = await res.json() as {
      results: Array<{ placeId: string; photoReference: string | null; description: string | null }>;
    };
    const place = json.results.find((r) => r.placeId === "ChIJ_nodetails");
    expect(place).toBeDefined();
    expect(place!.photoReference).toBeNull();
    expect(place!.description).toBeNull();
  });

  it("trip with hotel: response includes transitStations from Nearby Search", async () => {
    const { dest, profile, neighborhood } = seedWorld(db);

    // Insert a trip with hotel/lodging coords
    const tripWithHotel = db
      .insert(schema.trips)
      .values({
        familyProfileId: profile.id,
        destinationId: dest.id,
        selectedNeighborhoodId: neighborhood.id,
        startDate: "2026-09-01",
        endDate: "2026-09-04",
        status: "Discovery",
        lodgingAnchorLat: 35.700,
        lodgingAnchorLng: 139.590,
        lodgingAnchorAddress: "Park Hyatt Tokyo",
      })
      .returning()
      .all()[0]!;

    // Fetch sequence: eatTextSearch, eatDetails, visitTextSearch, NearbySearch(transit)
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeTextSearchResponse([])) // eat
      .mockResolvedValueOnce(makeTextSearchResponse([])) // visit
      .mockResolvedValueOnce({                           // transit Nearby Search
        ok: true,
        json: async () => ({
          status: "OK",
          results: [
            { place_id: "ts1", name: "Kichijoji Station", geometry: { location: { lat: 35.702, lng: 139.580 } } },
            { place_id: "ts2", name: "Inokashira-Koen Station", geometry: { location: { lat: 35.699, lng: 139.576 } } },
          ],
        }),
      } as Response);

    const res = await callPost(tripWithHotel.id);
    expect(res.status).toBe(200);

    const json = await res.json() as {
      transitStations: Array<{ placeId: string; name: string; lat: number; lng: number }>;
    };
    expect(json.transitStations).toHaveLength(2);
    expect(json.transitStations[0]!.name).toBe("Kichijoji Station");
    expect(json.transitStations[0]!.placeId).toBe("ts1");
  });

  it("trip without hotel: Nearby Search is called and transitStations are returned", async () => {
    const { trip } = seedWorld(db);

    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(makeTextSearchResponse([]))   // eat
      .mockResolvedValueOnce(makeTextSearchResponse([]))   // visit
      .mockResolvedValueOnce({                             // transit Nearby Search
        ok: true,
        json: async () => ({
          status: "OK",
          results: [
            { place_id: "ts1", name: "Kichijoji Station", geometry: { location: { lat: 35.702, lng: 139.580 } } },
          ],
        }),
      } as Response);
    global.fetch = fetchSpy;

    const res = await callPost(trip.id);
    expect(res.status).toBe(200);

    const json = await res.json() as { transitStations: Array<{ placeId: string; name: string }> };
    expect(json.transitStations).toHaveLength(1);
    expect(json.transitStations[0]!.name).toBe("Kichijoji Station");

    // 2 Text Search calls + 1 Nearby Search call
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("re-run (onConflictDoUpdate) updates description and returns latest photoReference", async () => {
    const { trip, neighborhood } = seedWorld(db);

    // First run
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeTextSearchResponse([
        makeTextSearchResult({ place_id: "ChIJ_update1", name: "Updatable Place", types: ["restaurant"], photo_reference: "ref-first" }),
      ]))
      .mockResolvedValueOnce(makeDetailsResponse({ editorial_summary: { overview: "First description." } }))
      .mockResolvedValueOnce(makeTextSearchResponse([]));

    await callPost(trip.id);

    // Verify first upsert persisted the description
    const { places: placesTable } = await import("@/db/schema");
    const { eq: eqFn } = await import("drizzle-orm");
    const firstRow = db.select().from(placesTable)
      .where(eqFn(placesTable.placeId, "ChIJ_update1"))
      .all()[0];
    expect(firstRow?.description).toBe("First description.");

    // Second run: same place but updated photo reference and description
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeTextSearchResponse([
        makeTextSearchResult({ place_id: "ChIJ_update1", name: "Updatable Place", types: ["restaurant"], photo_reference: "ref-updated" }),
      ]))
      .mockResolvedValueOnce(makeDetailsResponse({ editorial_summary: { overview: "Updated description." } }))
      .mockResolvedValueOnce(makeTextSearchResponse([]));

    const res2 = await callPost(trip.id);
    expect(res2.status).toBe(200);

    const secondRow = db.select().from(placesTable)
      .where(eqFn(placesTable.placeId, "ChIJ_update1"))
      .all()[0];
    expect(secondRow?.description).toBe("Updated description.");

    const json2 = await res2.json() as {
      results: Array<{ placeId: string; photoReference: string | null; description: string | null }>;
    };
    const place2 = json2.results.find((r) => r.placeId === "ChIJ_update1");
    expect(place2).toBeDefined();
    expect(place2!.photoReference).toBe("ref-updated");
    expect(place2!.description).toBe("Updated description.");

    void neighborhood;
  });
});
