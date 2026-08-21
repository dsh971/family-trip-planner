import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import path from "path";
import {
  isStale,
  STALENESS_TTL_DAYS,
  startOrJoin,
  markInProgress,
  markComplete,
  markPartial,
  _resetRegistryForTesting,
} from "./orchestrator";

const MIGRATIONS_FOLDER = path.resolve(__dirname, "../../db/migrations");

function createDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db;
}

type Db = ReturnType<typeof createDb>;

function seedDestination(db: Db) {
  return db
    .insert(schema.destinations)
    .values({
      slug: "kyoto",
      name: "Kyoto",
      country: "JP",
      defaultWalkingRadiusMeters: 1200,
      localeValidators: [],
      safetyDataSource: "OSAC 2024",
    })
    .returning()
    .all()[0]!;
}

function seedNeighborhood(db: Db, destinationId: number) {
  return db
    .insert(schema.neighborhoods)
    .values({
      destinationId,
      name: "Gion",
      centroidLat: 35.003,
      centroidLng: 135.778,
      walkingRadiusMeters: 800,
      familyFriendlinessScore: 80,
      dayInTheLifePreview: {
        highlights: ["Hanamikoji Street"],
        safetyNote: "Very safe",
        sampleBundle: "Temple → tea → shopping",
      },
      sources: ["timeout-kyoto"],
    })
    .returning()
    .all()[0]!;
}

// A controllable async generator: the test pushes items one at a time and
// awaits real timer ticks between pushes, so the driving loop inside
// startOrJoin has genuinely processed each item before the test moves on.
// This lets tests exercise actual timing/interleaving rather than just
// asserting call counts.
function createControllableGenerator<T>() {
  type Queued = { kind: "value"; value: T } | { kind: "done" } | { kind: "error"; error: unknown };
  const queue: Queued[] = [];
  let wake: (() => void) | null = null;
  let invocationCount = 0;

  async function* gen(): AsyncGenerator<T> {
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

  function runFn(): AsyncGenerator<T> {
    invocationCount++;
    return gen();
  }

  function push(value: T) {
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

  return { runFn, push, finish, fail, invocationCount: () => invocationCount };
}

// Flushes pending microtasks/timers so the background driveRun loop has a
// chance to process whatever was just pushed onto a controllable generator.
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("isStale", () => {
  it("returns true for null (never researched)", () => {
    expect(isStale(null)).toBe(true);
  });

  it("returns false for a researchedAt within the 90-day window", () => {
    const now = new Date("2026-08-20T00:00:00Z");
    const recentlyResearched = new Date("2026-07-01T00:00:00Z"); // ~50 days ago
    expect(isStale(recentlyResearched, now)).toBe(false);
  });

  it("returns true for a researchedAt older than the 90-day TTL", () => {
    expect(STALENESS_TTL_DAYS).toBe(90);
    const now = new Date("2026-08-20T00:00:00Z");
    const staleResearchedAt = new Date("2026-04-01T00:00:00Z"); // ~141 days ago
    expect(isStale(staleResearchedAt, now)).toBe(true);
  });

  it("treats exactly the TTL boundary as not yet stale", () => {
    const now = new Date("2026-08-20T00:00:00Z");
    const boundary = new Date(now.getTime() - STALENESS_TTL_DAYS * 24 * 60 * 60 * 1000);
    expect(isStale(boundary, now)).toBe(false);
  });
});

describe("startOrJoin", () => {
  beforeEach(() => {
    _resetRegistryForTesting();
  });

  afterEach(() => {
    _resetRegistryForTesting();
  });

  it("runs the underlying work exactly once for two concurrent callers on the same key", async () => {
    const controllable = createControllableGenerator<number>();

    const gen1 = startOrJoin("destination:1", controllable.runFn);
    const gen2 = startOrJoin("destination:1", controllable.runFn);

    expect(controllable.invocationCount()).toBe(1);

    controllable.push(1);
    controllable.push(2);
    controllable.finish();

    const results1: number[] = [];
    for await (const item of gen1) results1.push(item);
    const results2: number[] = [];
    for await (const item of gen2) results2.push(item);

    expect(results1).toEqual([1, 2]);
    expect(results2).toEqual([1, 2]);
    expect(controllable.invocationCount()).toBe(1);
  });

  it("backfills already-emitted items to a late joiner, then streams the rest as they resolve", async () => {
    const controllable = createControllableGenerator<number>();

    const early = startOrJoin("destination:2", controllable.runFn);

    // Start consuming `early` in the background so driveRun's progress isn't
    // gated on it, but don't await completion yet.
    const earlyResults: number[] = [];
    const earlyDone = (async () => {
      for await (const item of early) earlyResults.push(item);
    })();

    // Emit 3 of an eventual 8 items, with real timer ticks between each so
    // this genuinely exercises timing, not just synchronous buffering.
    for (let i = 1; i <= 3; i++) {
      controllable.push(i);
      await flush();
    }

    expect(controllable.invocationCount()).toBe(1);
    expect(earlyResults).toEqual([1, 2, 3]);

    // A second caller joins now, after 3 of 8 have already resolved.
    const late = startOrJoin("destination:2", controllable.runFn);
    expect(controllable.invocationCount()).toBe(1); // still just the one run

    const lateResults: number[] = [];
    const lateDone = (async () => {
      for await (const item of late) lateResults.push(item);
    })();

    // The late joiner must receive the 3 backfilled items immediately — not
    // just whatever arrives after it joined.
    await flush();
    expect(lateResults).toEqual([1, 2, 3]);

    // Stream the remaining 5 items.
    for (let i = 4; i <= 8; i++) {
      controllable.push(i);
      await flush();
    }
    controllable.finish();

    await earlyDone;
    await lateDone;

    expect(earlyResults).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(lateResults).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(controllable.invocationCount()).toBe(1);
  });

  it("clears the registry entry when a run finishes, so a later call for the same key starts fresh", async () => {
    const controllable = createControllableGenerator<number>();

    const gen1 = startOrJoin("destination:3", controllable.runFn);
    controllable.push(1);
    controllable.finish();

    const results1: number[] = [];
    for await (const item of gen1) results1.push(item);
    expect(results1).toEqual([1]);

    // New call for the same key after the first run finished: this must
    // start a brand-new run (a second invocation of runFn), not join the
    // now-dead one.
    const controllable2 = createControllableGenerator<number>();
    const gen2 = startOrJoin("destination:3", controllable2.runFn);
    controllable2.push(99);
    controllable2.finish();

    const results2: number[] = [];
    for await (const item of gen2) results2.push(item);

    expect(controllable2.invocationCount()).toBe(1);
    expect(results2).toEqual([99]);
  });

  it("a run that throws partway through delivers already-emitted items then rethrows to every subscriber, and clears the registry", async () => {
    const controllable = createControllableGenerator<number>();

    const gen1 = startOrJoin("destination:4", controllable.runFn);
    const gen2 = startOrJoin("destination:4", controllable.runFn);

    controllable.push(1);
    controllable.push(2);
    await flush();
    controllable.fail(new Error("source failure"));
    await flush();

    async function drain(gen: AsyncGenerator<number>) {
      const items: number[] = [];
      let error: unknown;
      try {
        for await (const item of gen) items.push(item);
      } catch (err) {
        error = err;
      }
      return { items, error };
    }

    const [outcome1, outcome2] = await Promise.all([drain(gen1), drain(gen2)]);

    expect(outcome1.items).toEqual([1, 2]);
    expect((outcome1.error as Error)?.message).toBe("source failure");
    expect(outcome2.items).toEqual([1, 2]);
    expect((outcome2.error as Error)?.message).toBe("source failure");

    // Registry cleared: a subsequent call for the same key starts fresh.
    const controllable2 = createControllableGenerator<number>();
    startOrJoin("destination:4", controllable2.runFn);
    expect(controllable2.invocationCount()).toBe(1);
  });

  it("a run that throws applies markPartial semantics: status ends 'partial', not 'complete'", async () => {
    const db = createDb();
    const dest = seedDestination(db);

    async function* runFn(): AsyncGenerator<number> {
      markInProgress(db, { kind: "destination", id: dest.id });
      try {
        yield 1;
        yield 2;
        throw new Error("source failure partway through");
      } catch (err) {
        markPartial(db, { kind: "destination", id: dest.id });
        throw err;
      }
    }

    const gen = startOrJoin(`destination:${dest.id}`, runFn);
    const items: number[] = [];
    let caught: unknown;
    try {
      for await (const item of gen) items.push(item);
    } catch (err) {
      caught = err;
    }

    expect(items).toEqual([1, 2]);
    expect(caught).toBeInstanceOf(Error);

    const row = db.select().from(schema.destinations).where(eq(schema.destinations.id, dest.id)).all()[0];
    expect(row?.researchStatus).toBe("partial");
    expect(row?.researchedAt).not.toBeNull();

    // Registry entry cleared: a later call starts a fresh run, not a join.
    const controllable2 = createControllableGenerator<number>();
    startOrJoin(`destination:${dest.id}`, controllable2.runFn);
    expect(controllable2.invocationCount()).toBe(1);
  });
});

describe("status-transition helpers", () => {
  it("markInProgress sets researchStatus and researchStartedAt for a destination", () => {
    const db = createDb();
    const dest = seedDestination(db);

    const before = db.select().from(schema.destinations).where(eq(schema.destinations.id, dest.id)).all()[0]!;
    expect(before.researchStatus).toBe("not_started");
    expect(before.researchStartedAt).toBeNull();

    markInProgress(db, { kind: "destination", id: dest.id }, new Date("2026-08-20T00:00:00Z"));

    const after = db.select().from(schema.destinations).where(eq(schema.destinations.id, dest.id)).all()[0]!;
    expect(after.researchStatus).toBe("in_progress");
    expect(after.researchStartedAt).toEqual(new Date("2026-08-20T00:00:00Z"));
  });

  it("markComplete sets researchStatus and researchedAt for a neighborhood", () => {
    const db = createDb();
    const dest = seedDestination(db);
    const neighborhood = seedNeighborhood(db, dest.id);

    markComplete(db, { kind: "neighborhood", id: neighborhood.id }, new Date("2026-08-20T00:00:00Z"));

    const after = db
      .select()
      .from(schema.neighborhoods)
      .where(eq(schema.neighborhoods.id, neighborhood.id))
      .all()[0]!;
    expect(after.researchStatus).toBe("complete");
    expect(after.researchedAt).toEqual(new Date("2026-08-20T00:00:00Z"));
  });

  it("markPartial sets researchStatus to 'partial' (not 'complete') and stamps researchedAt for a destination", () => {
    const db = createDb();
    const dest = seedDestination(db);

    markPartial(db, { kind: "destination", id: dest.id }, new Date("2026-08-20T00:00:00Z"));

    const after = db.select().from(schema.destinations).where(eq(schema.destinations.id, dest.id)).all()[0]!;
    expect(after.researchStatus).toBe("partial");
    expect(after.researchedAt).toEqual(new Date("2026-08-20T00:00:00Z"));
  });

  it("markPartial sets researchStatus to 'partial' for a neighborhood", () => {
    const db = createDb();
    const dest = seedDestination(db);
    const neighborhood = seedNeighborhood(db, dest.id);

    markPartial(db, { kind: "neighborhood", id: neighborhood.id }, new Date("2026-08-20T00:00:00Z"));

    const after = db
      .select()
      .from(schema.neighborhoods)
      .where(eq(schema.neighborhoods.id, neighborhood.id))
      .all()[0]!;
    expect(after.researchStatus).toBe("partial");
    expect(after.researchedAt).toEqual(new Date("2026-08-20T00:00:00Z"));
  });
});
