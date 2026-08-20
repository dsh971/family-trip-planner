import { describe, it, expect, vi, beforeEach } from "vitest";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import path from "path";
import { _resetRegistryForTesting } from "@/services/research/orchestrator";
import type { NeighborhoodCandidate } from "@/services/neighborhoods/discover";

const MIGRATIONS_FOLDER = path.resolve(__dirname, "../../../../../db/migrations");

function createDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db;
}

type Db = ReturnType<typeof createDb>;

function seedDestination(db: Db, overrides: Partial<typeof schema.destinations.$inferInsert> = {}) {
  return db
    .insert(schema.destinations)
    .values({
      slug: "lisbon",
      name: "Lisbon",
      country: "Portugal",
      defaultWalkingRadiusMeters: 1200,
      localeValidators: [],
      safetyDataSource: "",
      researchStatus: "not_started",
      ...overrides,
    })
    .returning()
    .all()[0]!;
}

function seedNeighborhood(db: Db, destinationId: number, name: string) {
  return db
    .insert(schema.neighborhoods)
    .values({
      destinationId,
      name,
      centroidLat: 38.71,
      centroidLng: -9.13,
      walkingRadiusMeters: 1200,
      familyFriendlinessScore: 50,
      dayInTheLifePreview: { highlights: ["x"], safetyNote: "safe", sampleBundle: "walk" },
      sources: ["seed"],
    })
    .returning()
    .all()[0]!;
}

function candidate(name: string): NeighborhoodCandidate {
  return {
    name,
    centroidLat: 38.71,
    centroidLng: -9.13,
    walkingRadiusMeters: 1200,
    familyFriendlinessScore: 50,
    dayInTheLifePreview: { highlights: [`${name} highlight`], safetyNote: "safe", sampleBundle: "walk" },
    sources: ["google-places-text-search"],
  };
}

// Mocks -----------------------------------------------------------------

vi.mock("@/db/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/db/client")>();
  return { ...original, getDb: vi.fn() };
});

vi.mock("@/services/wanderlust-goat/client", () => ({
  syncCity: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/services/neighborhoods/discover", () => ({
  generateDestinationHighlight: vi.fn((d: { name: string; country: string }) => `Discovering ${d.name}`),
  discoverNeighborhoods: vi.fn(),
}));

// A controllable async generator of NeighborhoodCandidate, mirroring
// src/services/research/orchestrator.test.ts's createControllableGenerator
// — lets tests push candidates one at a time with real timer ticks between
// them, and independently finish or fail the underlying "source".
function createControllableCandidates() {
  type Queued =
    | { kind: "value"; value: NeighborhoodCandidate }
    | { kind: "done" }
    | { kind: "error"; error: unknown };
  const queue: Queued[] = [];
  let wake: (() => void) | null = null;

  async function* gen(): AsyncGenerator<NeighborhoodCandidate> {
    for (;;) {
      while (queue.length === 0) {
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
      const next = queue.shift()!;
      if (next.kind === "value") {
        yield next.value;
      } else if (next.kind === "error") {
        throw next.error;
      } else {
        return;
      }
    }
  }

  function push(value: NeighborhoodCandidate) {
    queue.push({ kind: "value", value });
    wake?.();
    wake = null;
  }
  function finish() {
    queue.push({ kind: "done" });
    wake?.();
    wake = null;
  }
  function fail(error: unknown) {
    queue.push({ kind: "error", error });
    wake?.();
    wake = null;
  }

  return { gen, push, finish, fail };
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

interface SSEEvent {
  event: string;
  data: Record<string, unknown>;
}

// Reads one buffered SSE "event: ...\ndata: ...\n\n" block at a time from a
// Response's stream, maintaining its own decode buffer across calls so a
// test can interleave partial reads of multiple concurrent streams.
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

  return { readAll, events: pending };
}

async function makeResearchRequest(id: number, ip = "203.0.113.5") {
  const { GET } = await import("./route");
  const req = new Request(`http://localhost/api/destinations/${id}/research`, {
    headers: { "x-forwarded-for": ip },
  });
  return GET(req, { params: Promise.resolve({ id: String(id) }) });
}

describe("GET /api/destinations/[id]/research", () => {
  let db: Db;

  beforeEach(async () => {
    db = createDb();
    const { getDb } = await import("@/db/client");
    vi.mocked(getDb).mockReturnValue(db as ReturnType<typeof import("@/db/client").getDb>);

    const { _resetRateLimitForTesting } = await import("./route");
    _resetRateLimitForTesting();
    _resetRegistryForTesting();

    const { syncCity } = await import("@/services/wanderlust-goat/client");
    vi.mocked(syncCity).mockClear();
    vi.mocked(syncCity).mockResolvedValue(undefined);

    const { discoverNeighborhoods } = await import("@/services/neighborhoods/discover");
    vi.mocked(discoverNeighborhoods).mockReset();
  });

  it("happy path: streams a highlight first, then N neighborhood events, then done; ends researchStatus complete", async () => {
    const dest = seedDestination(db);
    const { discoverNeighborhoods } = await import("@/services/neighborhoods/discover");
    vi.mocked(discoverNeighborhoods).mockImplementation(async function* () {
      yield candidate("Alfama");
      yield candidate("Belém");
    });

    const res = await makeResearchRequest(dest.id);
    const { readAll } = createSSEReader(res);
    const events = await readAll();

    expect(events[0]!.event).toBe("highlight");
    expect(events[1]!.event).toBe("neighborhood");
    expect((events[1]!.data.neighborhood as { name: string }).name).toBe("Alfama");
    expect(events[2]!.event).toBe("neighborhood");
    expect((events[2]!.data.neighborhood as { name: string }).name).toBe("Belém");
    expect(events[3]!.event).toBe("done");
    expect(events).toHaveLength(4);

    const row = db.select().from(schema.destinations).where(eq(schema.destinations.id, dest.id)).all()[0]!;
    expect(row.researchStatus).toBe("complete");

    const rows = db.select().from(schema.neighborhoods).where(eq(schema.neighborhoods.destinationId, dest.id)).all();
    expect(rows).toHaveLength(2);
  });

  it("first-research sync: triggers syncCity when researchStatus is not_started", async () => {
    const dest = seedDestination(db, { researchStatus: "not_started" });
    const { discoverNeighborhoods } = await import("@/services/neighborhoods/discover");
    vi.mocked(discoverNeighborhoods).mockImplementation(async function* () {
      yield candidate("Alfama");
    });

    const res = await makeResearchRequest(dest.id);
    await createSSEReader(res).readAll();

    const { syncCity } = await import("@/services/wanderlust-goat/client");
    expect(syncCity).toHaveBeenCalledTimes(1);
    expect(syncCity).toHaveBeenCalledWith("Lisbon", "Portugal");
  });

  it("does not re-trigger syncCity for a destination already past not_started", async () => {
    const dest = seedDestination(db, { researchStatus: "partial", researchedAt: new Date() });
    const { discoverNeighborhoods } = await import("@/services/neighborhoods/discover");
    vi.mocked(discoverNeighborhoods).mockImplementation(async function* () {
      yield candidate("Alfama");
    });

    const res = await makeResearchRequest(dest.id);
    await createSSEReader(res).readAll();

    const { syncCity } = await import("@/services/wanderlust-goat/client");
    expect(syncCity).not.toHaveBeenCalled();
  });

  it("partial failure: persists and streams resolved neighborhoods, ends status partial, keeps prior results on retry", async () => {
    const dest = seedDestination(db);
    const { discoverNeighborhoods } = await import("@/services/neighborhoods/discover");
    vi.mocked(discoverNeighborhoods).mockImplementationOnce(async function* () {
      yield candidate("Alfama");
      yield candidate("Belém");
      yield candidate("Chiado");
      throw new Error("source failure");
    });

    const res = await makeResearchRequest(dest.id);
    const events = await createSSEReader(res).readAll();

    const neighborhoodEvents = events.filter((e) => e.event === "neighborhood");
    expect(neighborhoodEvents).toHaveLength(3);
    expect(events[events.length - 1]!.event).toBe("partial");

    let rows = db.select().from(schema.neighborhoods).where(eq(schema.neighborhoods.destinationId, dest.id)).all();
    expect(rows).toHaveLength(3);

    const destRow = db.select().from(schema.destinations).where(eq(schema.destinations.id, dest.id)).all()[0]!;
    expect(destRow.researchStatus).toBe("partial");

    // Subsequent call: prior results are not discarded, even though this
    // unit's re-research scope is "re-run discovery and upsert" rather than
    // "only the missing items" (documented simplification — see discover.ts
    // and route.ts comments).
    vi.mocked(discoverNeighborhoods).mockImplementationOnce(async function* () {
      yield candidate("Alfama");
      yield candidate("Belém");
      yield candidate("Chiado");
      yield candidate("Baixa");
    });

    const res2 = await makeResearchRequest(dest.id);
    await createSSEReader(res2).readAll();

    rows = db.select().from(schema.neighborhoods).where(eq(schema.neighborhoods.destinationId, dest.id)).all();
    const names = rows.map((r) => r.name).sort();
    expect(names).toEqual(["Alfama", "Baixa", "Belém", "Chiado"]);

    const destRow2 = db.select().from(schema.destinations).where(eq(schema.destinations.id, dest.id)).all()[0]!;
    expect(destRow2.researchStatus).toBe("complete");
  });

  it("cached/fresh: complete and not stale returns immediately with no research run", async () => {
    const dest = seedDestination(db, { researchStatus: "complete", researchedAt: new Date() });
    seedNeighborhood(db, dest.id, "Alfama");
    seedNeighborhood(db, dest.id, "Belém");

    const res = await makeResearchRequest(dest.id);
    const events = await createSSEReader(res).readAll();

    expect(events.some((e) => e.event === "highlight")).toBe(false);
    const neighborhoodEvents = events.filter((e) => e.event === "neighborhood");
    expect(neighborhoodEvents).toHaveLength(2);
    expect(events[events.length - 1]!.event).toBe("done");

    const { syncCity } = await import("@/services/wanderlust-goat/client");
    const { discoverNeighborhoods } = await import("@/services/neighborhoods/discover");
    expect(syncCity).not.toHaveBeenCalled();
    expect(discoverNeighborhoods).not.toHaveBeenCalled();
  });

  it("stale: complete but researchedAt older than 90 days triggers a fresh run without re-triggering syncCity", async () => {
    const staleDate = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);
    const dest = seedDestination(db, { researchStatus: "complete", researchedAt: staleDate });
    seedNeighborhood(db, dest.id, "OldNeighborhood");

    const { discoverNeighborhoods } = await import("@/services/neighborhoods/discover");
    vi.mocked(discoverNeighborhoods).mockImplementation(async function* () {
      yield candidate("Alfama");
    });

    const res = await makeResearchRequest(dest.id);
    const events = await createSSEReader(res).readAll();

    expect(events[0]!.event).toBe("highlight");
    expect(events.some((e) => e.event === "neighborhood")).toBe(true);
    expect(events[events.length - 1]!.event).toBe("done");

    const { syncCity } = await import("@/services/wanderlust-goat/client");
    expect(syncCity).not.toHaveBeenCalled();

    const destRow = db.select().from(schema.destinations).where(eq(schema.destinations.id, dest.id)).all()[0]!;
    expect(destRow.researchStatus).toBe("complete");
    expect(destRow.researchedAt!.getTime()).toBeGreaterThan(staleDate.getTime());
  });

  it("concurrent join: two simultaneous requests share one run; a late joiner receives the full backfilled stream", async () => {
    const dest = seedDestination(db);
    const controllable = createControllableCandidates();
    const { discoverNeighborhoods } = await import("@/services/neighborhoods/discover");
    vi.mocked(discoverNeighborhoods).mockImplementation(() => controllable.gen());

    const resA = await makeResearchRequest(dest.id, "203.0.113.10");
    const readerA = createSSEReader(resA);
    const eventsAPromise = readerA.readAll();

    // Let A's request start driving the run and receive the highlight +
    // first candidate before B joins.
    await flush();
    controllable.push(candidate("Alfama"));
    await flush();

    const { syncCity } = await import("@/services/wanderlust-goat/client");
    expect(syncCity).toHaveBeenCalledTimes(1);

    // B joins mid-run, after the highlight and first candidate resolved.
    const resB = await makeResearchRequest(dest.id, "203.0.113.11");
    const readerB = createSSEReader(resB);
    const eventsBPromise = readerB.readAll();

    controllable.push(candidate("Belém"));
    await flush();
    controllable.finish();

    const [eventsA, eventsB] = await Promise.all([eventsAPromise, eventsBPromise]);

    // Only one run: syncCity called exactly once across both requests.
    expect(syncCity).toHaveBeenCalledTimes(1);

    for (const events of [eventsA, eventsB]) {
      expect(events[0]!.event).toBe("highlight");
      const names = events.filter((e) => e.event === "neighborhood").map((e) => (e.data.neighborhood as { name: string }).name);
      expect(names).toEqual(["Alfama", "Belém"]);
      expect(events[events.length - 1]!.event).toBe("done");
    }

    const destRow = db.select().from(schema.destinations).where(eq(schema.destinations.id, dest.id)).all()[0]!;
    expect(destRow.researchStatus).toBe("complete");
  });

  it("rate limit: requests beyond the per-IP threshold are rejected with 429", async () => {
    const dest = seedDestination(db);
    const { discoverNeighborhoods } = await import("@/services/neighborhoods/discover");
    vi.mocked(discoverNeighborhoods).mockImplementation(async function* () {
      yield candidate("Alfama");
    });

    const ip = "198.51.100.20";
    let lastStatus = 200;
    for (let i = 0; i < 15; i++) {
      // Each request targets a fresh destination-less path isn't needed —
      // rate limiting is checked before the DB lookup, so repeated calls
      // against the same id are sufficient to exercise it.
      const res = await makeResearchRequest(dest.id, ip);
      if (res.status !== 200) {
        // Drain nothing — non-200 responses are plain JSON, not a stream.
      } else {
        await createSSEReader(res).readAll();
      }
      lastStatus = res.status;
    }

    expect(lastStatus).toBe(429);
  });
});
