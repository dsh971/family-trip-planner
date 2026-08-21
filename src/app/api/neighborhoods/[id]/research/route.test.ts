import { describe, it, expect, vi, beforeEach } from "vitest";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import path from "path";
import { _resetRegistryForTesting } from "@/services/research/orchestrator";

const MIGRATIONS_FOLDER = path.resolve(__dirname, "../../../../../db/migrations");

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

function seedDestination(db: Db, overrides: Partial<typeof schema.destinations.$inferInsert> = {}) {
  return db
    .insert(schema.destinations)
    .values({
      slug: "kyoto",
      name: "Kyoto",
      country: "Japan",
      defaultWalkingRadiusMeters: 1200,
      localeValidators: [],
      safetyDataSource: "",
      researchStatus: "complete",
      ...overrides,
    })
    .returning()
    .all()[0]!;
}

function seedNeighborhood(
  db: Db,
  destinationId: number,
  name: string,
  overrides: Partial<typeof schema.neighborhoods.$inferInsert> = {}
) {
  return db
    .insert(schema.neighborhoods)
    .values({
      destinationId,
      name,
      centroidLat: 35.011,
      centroidLng: 135.768,
      walkingRadiusMeters: 800,
      familyFriendlinessScore: 80,
      dayInTheLifePreview: { highlights: [`${name} highlight`], safetyNote: "safe", sampleBundle: "walk" },
      sources: ["seed"],
      researchStatus: "not_started",
      ...overrides,
    })
    .returning()
    .all()[0]!;
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
        lat: overrides.lat ?? 35.011,
        lng: overrides.lng ?? 135.768,
      },
    },
    rating: overrides.rating ?? 4.0,
    user_ratings_total: overrides.user_ratings_total ?? 200,
    price_level: overrides.price_level ?? 2,
    types: overrides.types ?? ["restaurant"],
  };
}

function makeTextSearchResponse(items: unknown[]) {
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

interface SSEEvent {
  event: string;
  data: Record<string, unknown>;
}

// Reads all buffered SSE "event: ...\ndata: ...\n\n" blocks from a
// Response's stream. Mirrors
// src/app/api/destinations/[id]/research/route.test.ts's createSSEReader.
function createSSEReader(response: Response) {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const pending: SSEEvent[] = [];

  function drainBuffer() {
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      let eventName = "message";
      let dataStr = "";
      for (const line of chunk.split("\n")) {
        if (line.startsWith("event: ")) eventName = line.slice(7);
        else if (line.startsWith("data: ")) dataStr = line.slice(6);
      }
      pending.push({ event: eventName, data: dataStr ? JSON.parse(dataStr) : {} });
    }
  }

  async function readAll(): Promise<SSEEvent[]> {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
    }
    drainBuffer();
    return pending;
  }

  return { readAll };
}

async function makeResearchRequest(id: number, ip = "203.0.113.5") {
  const { GET } = await import("./route");
  const req = new Request(`http://localhost/api/neighborhoods/${id}/research`, {
    headers: { "x-forwarded-for": ip },
  });
  return GET(req, { params: Promise.resolve({ id: String(id) }) });
}

describe("GET /api/neighborhoods/[id]/research", () => {
  let db: Db;

  beforeEach(async () => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "test-key");
    db = createDb();
    const { getDb } = await import("@/db/client");
    vi.mocked(getDb).mockReturnValue(db as ReturnType<typeof import("@/db/client").getDb>);

    const { _resetRateLimitForTesting } = await import("./route");
    _resetRateLimitForTesting();
    _resetRegistryForTesting();

    const { checkAvailability, discoverGoat } = await import("@/services/wanderlust-goat/client");
    vi.mocked(checkAvailability).mockReset().mockResolvedValue(false);
    vi.mocked(discoverGoat).mockReset().mockResolvedValue({ results: [] } as never);
  });

  it("happy path: a neighborhood with no prior research streams place events, ends done, researchStatus complete", async () => {
    const dest = seedDestination(db);
    const neighborhood = seedNeighborhood(db, dest.id, "Gion");

    // eat: 1 result + details; visit: 1 result + details
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeTextSearchResponse([
        makeTextSearchResult({ place_id: "ChIJ_eat1", name: "Family Udon", types: ["restaurant"] }),
      ]))
      .mockResolvedValueOnce(makeDetailsResponse({}))
      .mockResolvedValueOnce(makeTextSearchResponse([
        makeTextSearchResult({ place_id: "ChIJ_visit1", name: "Bamboo Grove", types: ["park"] }),
      ]))
      .mockResolvedValueOnce(makeDetailsResponse({}));

    const res = await makeResearchRequest(neighborhood.id);
    const events = await createSSEReader(res).readAll();

    const placeEvents = events.filter((e) => e.event === "place");
    expect(placeEvents).toHaveLength(2);
    const names = placeEvents.map((e) => (e.data.place as { name: string }).name);
    expect(names).toEqual(["Family Udon", "Bamboo Grove"]);
    expect(events[events.length - 1]!.event).toBe("done");

    const row = db.select().from(schema.neighborhoods).where(eq(schema.neighborhoods.id, neighborhood.id)).all()[0]!;
    expect(row.researchStatus).toBe("complete");

    const persisted = db.select().from(schema.places).where(eq(schema.places.neighborhoodId, neighborhood.id)).all();
    expect(persisted).toHaveLength(2);
  });

  it("partial failure: already-resolved places from the first category are kept and streamed; the pass does not fail outright", async () => {
    // Google Places succeeds normally for "eat" (fully resolves and
    // persists). For "visit" a malformed Text Search result (missing
    // lat/lng) reaches the per-place upsert unguarded — exactly like the
    // synchronous /api/discovery route's original per-place upsert step,
    // which has never been wrapped in a try/catch. Today's synchronous
    // route lets this bubble uncaught and lose the ENTIRE response (even
    // though "eat" already committed to the DB); the streamed route must
    // instead keep+stream what already resolved and end "partial".
    const dest = seedDestination(db);
    const neighborhood = seedNeighborhood(db, dest.id, "Gion");

    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeTextSearchResponse([
        makeTextSearchResult({ place_id: "ChIJ_eat1", name: "Family Udon", types: ["restaurant"] }),
      ]))
      .mockResolvedValueOnce(makeDetailsResponse({}))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: "OK",
          results: [
            {
              place_id: "ChIJ_visit_bad",
              name: "Malformed Place",
              // geometry.location intentionally missing lat/lng — places.lat/lng
              // are NOT NULL columns, so the upsert throws when this reaches it.
              geometry: { location: {} },
              types: ["park"],
            },
          ],
        }),
      } as Response)
      .mockResolvedValueOnce(makeDetailsResponse({}));

    const res = await makeResearchRequest(neighborhood.id);
    const events = await createSSEReader(res).readAll();

    const placeEvents = events.filter((e) => e.event === "place");
    expect(placeEvents).toHaveLength(1);
    expect((placeEvents[0]!.data.place as { name: string }).name).toBe("Family Udon");
    expect(events[events.length - 1]!.event).toBe("partial");

    const persisted = db.select().from(schema.places).where(eq(schema.places.neighborhoodId, neighborhood.id)).all();
    expect(persisted).toHaveLength(1);
    expect(persisted[0]!.name).toBe("Family Udon");

    const row = db.select().from(schema.neighborhoods).where(eq(schema.neighborhoods.id, neighborhood.id)).all()[0]!;
    expect(row.researchStatus).toBe("partial");
  });

  it("cached/fresh neighborhood: renders immediately, no research run (R7, AE2)", async () => {
    const dest = seedDestination(db);
    const neighborhood = seedNeighborhood(db, dest.id, "Gion", {
      researchStatus: "complete",
      researchedAt: new Date(),
    });

    db.insert(schema.places)
      .values({
        neighborhoodId: neighborhood.id,
        placeId: "ChIJ_cached1",
        name: "Cached Ramen",
        category: "eat",
        lat: 35.011,
        lng: 135.768,
        sources: ["google-places-text-search"],
        corroborationScore: 1,
      })
      .run();

    const fetchSpy = vi.fn();
    global.fetch = fetchSpy;

    const res = await makeResearchRequest(neighborhood.id);
    const events = await createSSEReader(res).readAll();

    const placeEvents = events.filter((e) => e.event === "place");
    expect(placeEvents).toHaveLength(1);
    expect((placeEvents[0]!.data.place as { name: string }).name).toBe("Cached Ramen");
    expect(events[events.length - 1]!.event).toBe("done");

    // No research actually ran: no Google Places calls, no WG calls.
    expect(fetchSpy).not.toHaveBeenCalled();
    const { checkAvailability } = await import("@/services/wanderlust-goat/client");
    expect(checkAvailability).not.toHaveBeenCalled();
  });

  it("multiple neighborhoods selected: researching one neighborhood does not touch another neighborhood's places", async () => {
    const dest = seedDestination(db);
    const neighborhoodA = seedNeighborhood(db, dest.id, "Gion");
    const neighborhoodB = seedNeighborhood(db, dest.id, "Arashiyama");

    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeTextSearchResponse([
        makeTextSearchResult({ place_id: "ChIJ_a_eat", name: "Gion Place" }),
      ]))
      .mockResolvedValueOnce(makeDetailsResponse({}))
      .mockResolvedValueOnce(makeTextSearchResponse([]));

    const resA = await makeResearchRequest(neighborhoodA.id, "203.0.113.20");
    await createSSEReader(resA).readAll();

    const placesA = db.select().from(schema.places).where(eq(schema.places.neighborhoodId, neighborhoodA.id)).all();
    const placesB = db.select().from(schema.places).where(eq(schema.places.neighborhoodId, neighborhoodB.id)).all();
    expect(placesA).toHaveLength(1);
    expect(placesB).toHaveLength(0);

    const rowB = db.select().from(schema.neighborhoods).where(eq(schema.neighborhoods.id, neighborhoodB.id)).all()[0]!;
    expect(rowB.researchStatus).toBe("not_started");

    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeTextSearchResponse([
        makeTextSearchResult({ place_id: "ChIJ_b_eat", name: "Arashiyama Place" }),
      ]))
      .mockResolvedValueOnce(makeDetailsResponse({}))
      .mockResolvedValueOnce(makeTextSearchResponse([]));

    const resB = await makeResearchRequest(neighborhoodB.id, "203.0.113.21");
    await createSSEReader(resB).readAll();

    const placesA2 = db.select().from(schema.places).where(eq(schema.places.neighborhoodId, neighborhoodA.id)).all();
    const placesB2 = db.select().from(schema.places).where(eq(schema.places.neighborhoodId, neighborhoodB.id)).all();
    expect(placesA2).toHaveLength(1); // unchanged
    expect(placesB2).toHaveLength(1);
  });

  it("rate limit: requests beyond the per-IP threshold are rejected with 429", async () => {
    const dest = seedDestination(db);
    const neighborhood = seedNeighborhood(db, dest.id, "Gion");

    global.fetch = vi.fn().mockResolvedValue(makeTextSearchResponse([]));

    const ip = "198.51.100.30";
    let lastStatus = 200;
    for (let i = 0; i < 15; i++) {
      const res = await makeResearchRequest(neighborhood.id, ip);
      if (res.status === 200) {
        await createSSEReader(res).readAll();
      }
      lastStatus = res.status;
    }

    expect(lastStatus).toBe(429);
  });
});
