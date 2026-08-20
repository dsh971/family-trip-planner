import { eq } from "drizzle-orm";
import type { getDb } from "@/db/client";
import { destinations, neighborhoods } from "@/db/schema";

type Db = ReturnType<typeof getDb>;

// ---------------------------------------------------------------------------
// Staleness (R2, R7)
// ---------------------------------------------------------------------------

// 90-day TTL (plan 2026-08-20-011 Key Technical Decisions): cached research
// older than this is eligible for re-research on next visit. Named/exported
// as a constant so it's easy to tune without hunting for a magic number.
export const STALENESS_TTL_DAYS = 90;

const STALENESS_TTL_MS = STALENESS_TTL_DAYS * 24 * 60 * 60 * 1000;

// True for null/never-researched, and for anything older than the TTL.
// Used identically for destinations.researchedAt (neighborhood-discovery
// stage) and neighborhoods.researchedAt (place-research stage) — both share
// the same staleness semantics per the state machine in the plan's
// High-Level Technical Design.
export function isStale(researchedAt: Date | null, now: Date = new Date()): boolean {
  if (researchedAt === null) return true;
  return now.getTime() - researchedAt.getTime() > STALENESS_TTL_MS;
}

// ---------------------------------------------------------------------------
// Status-transition helpers (R2, R9)
// ---------------------------------------------------------------------------

// Which research-tracked table a status transition applies to. Destinations
// carry the neighborhood-discovery stage's status; neighborhoods carry the
// place-research stage's status — same column shapes (researchStatus /
// researchStartedAt / researchedAt), different granularity. A single
// discriminated ref (rather than six kind-specific functions) keeps the
// surface small while staying simple to call from either stage's runFn.
export type ResearchEntityKind = "destination" | "neighborhood";

export interface ResearchEntityRef {
  kind: ResearchEntityKind;
  id: number;
}

// Marks a run as actively in progress: sets researchStartedAt to now.
// Called once at the start of a fresh run (not on a joined one — joiners
// don't re-trigger this).
export function markInProgress(db: Db, ref: ResearchEntityRef, now: Date = new Date()): void {
  if (ref.kind === "destination") {
    db.update(destinations)
      .set({ researchStatus: "in_progress", researchStartedAt: now })
      .where(eq(destinations.id, ref.id))
      .run();
  } else {
    db.update(neighborhoods)
      .set({ researchStatus: "in_progress", researchStartedAt: now })
      .where(eq(neighborhoods.id, ref.id))
      .run();
  }
}

// Marks a run fully resolved: all items researched, no source failures.
export function markComplete(db: Db, ref: ResearchEntityRef, now: Date = new Date()): void {
  if (ref.kind === "destination") {
    db.update(destinations)
      .set({ researchStatus: "complete", researchedAt: now })
      .where(eq(destinations.id, ref.id))
      .run();
  } else {
    db.update(neighborhoods)
      .set({ researchStatus: "complete", researchedAt: now })
      .where(eq(neighborhoods.id, ref.id))
      .run();
  }
}

// Marks a run partially resolved: some items persisted before a source
// failure (or an uncaught throw) cut the run short. researchedAt is still
// stamped — the partial results that did resolve are real and current — so a
// later retry only re-researches what's still missing, per this plan's
// "partial results are kept and rendered, not discarded on failure" decision.
export function markPartial(db: Db, ref: ResearchEntityRef, now: Date = new Date()): void {
  if (ref.kind === "destination") {
    db.update(destinations)
      .set({ researchStatus: "partial", researchedAt: now })
      .where(eq(destinations.id, ref.id))
      .run();
  } else {
    db.update(neighborhoods)
      .set({ researchStatus: "partial", researchedAt: now })
      .where(eq(neighborhoods.id, ref.id))
      .run();
  }
}

// ---------------------------------------------------------------------------
// In-flight run registry + join semantics (R2, R6, R9)
// ---------------------------------------------------------------------------
//
// Key convention: callers key runs as `destination:${id}` for neighborhood-
// discovery (U5) or `neighborhood:${id}` for place-research (U6). Any unique
// string works — startOrJoin doesn't parse the key — but this convention
// keeps the two stages' runs from ever colliding in the shared Map even
// though destination ids and neighborhood ids can overlap numerically.
//
// This is a single-process, in-memory registry (per the Dockerfile's
// monolith deployment — see plan Key Technical Decisions and Risks &
// Dependencies: a run in progress at process restart is lost, and that's an
// accepted limitation, not a bug). No external queue, no distributed lock.

interface Run<T> {
  // Every item emitted so far, in arrival order. A joiner that subscribes
  // mid-run replays this buffer before receiving anything new — this is the
  // deliberate correction (per plan) to an earlier draft that would only
  // have delivered future emissions and missed backfill.
  items: T[];
  done: boolean;
  error: unknown;
  // Resolvers for consumers currently parked waiting for the next item or
  // for the run to finish. Cleared and re-populated on every notify().
  waiters: Array<() => void>;
}

// Keyed by the string convention documented above. Values are cast to
// `Run<T>` at the startOrJoin boundary — the registry itself is untyped
// per-entry because a single Map spans every key/T pairing callers use.
const registry = new Map<string, Run<unknown>>();

function notify<T>(run: Run<T>): void {
  const waiters = run.waiters;
  run.waiters = [];
  for (const resolve of waiters) resolve();
}

// Drains the underlying generator into the shared buffer, notifying any
// parked consumers as items arrive. Runs independently of whether anyone is
// actually iterating a subscriber generator — the work itself doesn't wait
// on slow readers. Always resolves (never rejects): a thrown/rejected item
// from `gen` is captured on `run.error` and re-surfaced to each subscriber
// individually via `subscribe`, not as an unhandled rejection here.
async function driveRun<T>(key: string, run: Run<T>, gen: AsyncGenerator<T>): Promise<void> {
  try {
    for await (const item of gen) {
      run.items.push(item);
      notify(run);
    }
  } catch (err) {
    run.error = err;
  } finally {
    run.done = true;
    notify(run);
    // Clear the registry entry so a subsequent startOrJoin(key, ...) starts a
    // fresh run rather than joining this now-dead one. Guarded by identity in
    // case a test reset or a same-key race already replaced this entry.
    if (registry.get(key) === (run as Run<unknown>)) {
      registry.delete(key);
    }
  }
}

// Replays whatever's already buffered, then continues to yield new items as
// driveRun pushes them, until the run finishes. If the run ended in error,
// that error is thrown after the buffered items have been yielded (so a
// consumer sees everything that *did* resolve before finding out the run
// didn't fully succeed).
async function* subscribe<T>(run: Run<T>): AsyncGenerator<T> {
  let index = 0;
  for (;;) {
    while (index < run.items.length) {
      yield run.items[index] as T;
      index++;
    }
    if (run.done) {
      if (run.error) throw run.error;
      return;
    }
    await new Promise<void>((resolve) => run.waiters.push(resolve));
  }
}

// Starts a new run for `key` by invoking `runFn`, or — if a run is already
// active for `key` — joins it instead of starting a duplicate. Every caller,
// whether starting or joining, gets an AsyncGenerator that first replays
// everything already emitted so far, then streams new emissions as they
// arrive alongside every other joiner. The registry entry is cleared once
// the run finishes (success, partial failure, or throw), so the next call
// for the same key always starts fresh rather than joining a dead run.
export function startOrJoin<T>(key: string, runFn: () => AsyncGenerator<T>): AsyncGenerator<T> {
  let run = registry.get(key) as Run<T> | undefined;
  if (!run) {
    run = { items: [], done: false, error: undefined, waiters: [] };
    registry.set(key, run as Run<unknown>);
    // Intentionally not awaited: the run drives itself in the background so
    // progress isn't gated on any particular subscriber actually reading.
    void driveRun(key, run, runFn());
  }
  return subscribe(run);
}

// Resets the run registry. Only intended for use in tests — module-level
// mutable state otherwise leaks between test cases (mirrors
// src/services/wanderlust-goat/client.ts's _resetAvailabilityForTesting()).
export function _resetRegistryForTesting(): void {
  registry.clear();
}
