import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { destinations, neighborhoods, type Destination, type Neighborhood } from "@/db/schema";
import {
  isStale,
  markInProgress,
  markComplete,
  markPartial,
} from "@/services/research/orchestrator";
import { buildResearchSSEResponse } from "@/services/research/sseResearchStream";
import { syncCity } from "@/services/wanderlust-goat/client";
import {
  generateDestinationHighlight,
  discoverNeighborhoods,
  type NeighborhoodCandidate,
} from "@/services/neighborhoods/discover";
import { createRateLimiter } from "@/lib/rateLimit";
import { sseErrorResponse } from "@/lib/sse";

// U5 (plan 2026-08-20-011): SSE endpoint that runs (or joins) a
// destination's neighborhood-discovery research pass and streams results as
// they resolve — GET only, since EventSource can't use other verbs.

type Db = ReturnType<typeof getDb>;

// --- Rate limiting -----------------------------------------------------
// See src/lib/rateLimit.ts for why this buckets on a single shared key
// rather than a per-IP one.
const rateLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 10 });

// Test-only escape hatch, mirroring src/app/api/destinations/route.ts.
export function _resetRateLimitForTesting(): void {
  rateLimiter.reset();
}

// --- SSE event shapes -----------------------------------------------------

interface HighlightEvent {
  type: "highlight";
  destinationId: number;
  text: string;
}

interface NeighborhoodEvent {
  type: "neighborhood";
  neighborhood: Neighborhood;
}

type ResearchStreamEvent = HighlightEvent | NeighborhoodEvent;

function persistNeighborhood(
  db: Db,
  destinationId: number,
  candidate: NeighborhoodCandidate
): Neighborhood | undefined {
  // Mirrors src/app/api/discovery/route.ts's places upsert pattern, using
  // U1's new (destinationId, name) unique index as the conflict target so a
  // re-run for the same destination updates existing rows in place instead
  // of inserting duplicates.
  const rows = db
    .insert(neighborhoods)
    .values({
      destinationId,
      name: candidate.name,
      centroidLat: candidate.centroidLat,
      centroidLng: candidate.centroidLng,
      walkingRadiusMeters: candidate.walkingRadiusMeters,
      familyFriendlinessScore: candidate.familyFriendlinessScore,
      dayInTheLifePreview: candidate.dayInTheLifePreview,
      sources: candidate.sources,
    })
    .onConflictDoUpdate({
      target: [neighborhoods.destinationId, neighborhoods.name],
      set: {
        centroidLat: candidate.centroidLat,
        centroidLng: candidate.centroidLng,
        walkingRadiusMeters: candidate.walkingRadiusMeters,
        familyFriendlinessScore: candidate.familyFriendlinessScore,
        dayInTheLifePreview: candidate.dayInTheLifePreview,
        sources: candidate.sources,
      },
    })
    .returning()
    .all();
  return rows[0];
}

function markWgSynced(db: Db, destinationId: number): void {
  db.update(destinations).set({ wgSyncedAt: new Date() }).where(eq(destinations.id, destinationId)).run();
}

// Guards against firing syncCity twice concurrently for the same
// destination. The live-research path is already deduped by
// orchestrator.startOrJoin, but the cached-path call to ensureWgSynced
// below runs outside that registry — two near-simultaneous requests for the
// same never-synced destination would each read a `wgSyncedAt: null`
// snapshot before either write lands, and without this guard both would
// fire the real CLI call. Checked-and-set synchronously (no await between
// the check and the add), mirroring the same idiom this codebase already
// uses for exactly this kind of single-process de-duplication (this WG
// client's own `_available` cache, orchestrator.ts's run registry).
const wgSyncInFlight = new Set<number>();

// Test-only escape hatch, mirroring this file's own _resetRateLimitForTesting
// and orchestrator.ts's _resetRegistryForTesting. Needed in tests because a
// deliberately never-resolving syncCity mock (used to prove the cached path
// doesn't block on it) would otherwise leave an entry here forever, and each
// test's in-memory SQLite DB restarts autoincrement IDs from 1 — leaking a
// stale entry into an unrelated later test's same-numbered destination.
export function _resetWgSyncInFlightForTesting(): void {
  wgSyncInFlight.clear();
}

// Hydrates WG's local per-city data store the first time (ever) a
// destination needs it, gated on wgSyncedAt rather than researchStatus.
//
// Code review finding (2026-08-21): the original gate was
// `researchStatus === "not_started"`, but migration 0005's backfill marks
// every pre-existing seeded destination (Tokyo) "complete" directly —
// meaning that gate would never fire for Tokyo again, permanently skipping
// syncCity for it under this architecture (KTD-J calls WG corroboration
// load-bearing). wgSyncedAt is independent of researchStatus and stays
// null until this function actually succeeds, so a backfilled destination
// still gets synced on its very next visit — whether that visit takes the
// live-research path below or the cached fast path in GET.
//
// Deliberately NOT awaited by either caller (fire-and-forget): neither the
// live-research neighborhood-discovery loop nor the cached-path response
// consumes WG data (only U6's per-neighborhood place-research does, later,
// well after this resolves in practice), so blocking either of them on
// this function's 2-5 minute real-world duration would only add latency
// with no correctness benefit — and on the cached path specifically it
// would silently break R7/R9's "renders immediately, no wait state"
// contract for the one-time case of a backfilled-but-never-synced
// destination. This process is a long-lived `next start` container (not
// serverless), so the promise keeps running after the caller stops
// awaiting it; its own try/catch below never lets a failure escape as an
// unhandled rejection.
async function ensureWgSynced(db: Db, destination: Destination): Promise<void> {
  if (destination.wgSyncedAt !== null) return;
  if (wgSyncInFlight.has(destination.id)) return;
  wgSyncInFlight.add(destination.id);
  try {
    await syncCity(destination.name, destination.country);
    markWgSynced(db, destination.id);
  } catch (err) {
    // sync-city failure degrades WG corroboration quality for this
    // destination (KTD-J) but doesn't block neighborhood discovery, which
    // doesn't depend on WG in this unit at all — logged, not fatal, per
    // this codebase's existing "WG unavailable → degrade gracefully"
    // convention (src/app/api/discovery/route.ts's wgInstalled handling).
    // Left unset so the next visit retries rather than being marked synced
    // on a failed attempt.
    console.warn(
      `[Research] sync-city failed for ${destination.name}, ${destination.country}:`,
      err instanceof Error ? err.message : err
    );
  } finally {
    wgSyncInFlight.delete(destination.id);
  }
}

// The run function passed to orchestrator.startOrJoin. Only the winning
// caller's closure for a given key ever actually executes this (see
// orchestrator.ts's startOrJoin) — joiners subscribe to its output instead,
// so ensureWgSynced/markInProgress below only ever run once per research
// run, even under a concurrent-join race.
//
// Error handling mirrors the exact convention orchestrator.test.ts already
// establishes for runFns: on failure, call markPartial and RETHROW (don't
// swallow) — orchestrator's subscribe() replays every already-buffered item
// to each subscriber before re-surfacing the error, so nothing already
// resolved is lost (plan KTD: "partial results are kept and rendered, not
// discarded on failure"). The calling route below is what turns that
// rethrown error into a terminal "partial" SSE event instead of an
// unhandled rejection.
async function* runResearch(db: Db, destination: Destination): AsyncGenerator<ResearchStreamEvent> {
  markInProgress(db, { kind: "destination", id: destination.id });

  // Highlight-first: emitted before syncCity and before any neighborhood
  // event, per this plan's Key Technical Decision ("emitted first ... so
  // it's available for the entire wait, not just whatever's left of it").
  // Code review finding (2026-08-21): this used to run AFTER syncCity's
  // 2-5 minute await, leaving the stream silent for the entire wait instead
  // of available for it.
  yield {
    type: "highlight",
    destinationId: destination.id,
    text: generateDestinationHighlight(destination),
  };

  // Not awaited — see ensureWgSynced's comment. Runs concurrently with the
  // discovery loop below rather than blocking it.
  void ensureWgSynced(db, destination);

  try {
    for await (const candidate of discoverNeighborhoods(destination)) {
      const row = persistNeighborhood(db, destination.id, candidate);
      if (row) {
        yield { type: "neighborhood", neighborhood: row };
      }
    }
  } catch (err) {
    markPartial(db, { kind: "destination", id: destination.id });
    throw err;
  }

  markComplete(db, { kind: "destination", id: destination.id });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (rateLimiter.isRateLimited()) {
    return sseErrorResponse("Too many requests. Please wait a moment and try again.");
  }

  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) {
    return sseErrorResponse("Invalid destination id");
  }

  const db = getDb();
  const destination = db.select().from(destinations).where(eq(destinations.id, id)).all()[0];
  if (!destination) {
    return sseErrorResponse("Destination not found");
  }

  // U7 (plan 2026-08-20-011): manual re-research trigger support. `force`
  // bypasses the cached/fresh fast-path below so a `complete`, non-stale
  // destination re-enters research through runResearch as if not_started.
  // It does not force a re-sync of WG data: ensureWgSynced (called from
  // runResearch) is gated on destination.wgSyncedAt, not researchStatus or
  // this flag, so an already-synced destination correctly skips syncCity
  // on a forced re-run — only neighborhood discovery re-runs.
  const force = new URL(request.url).searchParams.get("force") === "true";

  return buildResearchSSEResponse({
    // Cached/fresh path (R7, AE2): complete and not stale — stream the
    // already-persisted neighborhoods immediately. Still shaped as SSE
    // events for a consistent client contract, but with no research run and
    // no wait state.
    isCached: !force && destination.researchStatus === "complete" && !isStale(destination.researchedAt),
    streamCached: (enqueue) => {
      // A destination backfilled straight to "complete" (migration 0005,
      // e.g. Tokyo) never had a live research run and so was never
      // wgSynced either — ensureWgSynced closes that gap on the fast path
      // too, not just the live-research path below. Not awaited: this
      // branch's whole contract (R7/R9) is "renders immediately, no wait
      // state" — see ensureWgSynced's comment.
      void ensureWgSynced(db, destination);
      const existing = db
        .select()
        .from(neighborhoods)
        .where(eq(neighborhoods.destinationId, destination.id))
        .all();
      for (const n of existing) {
        enqueue("neighborhood", { type: "neighborhood", neighborhood: n });
      }
    },
    // Otherwise: not_started, in_progress, partial, or stale-complete — all
    // treated as "run (or join) research" per the state machine in the
    // rewrite's High-Level Technical Design. Stale-complete is routed
    // through the same path as not_started; ensureWgSynced's own
    // wgSyncedAt gate (not this branch) is what keeps an already-synced
    // destination from re-syncing WG on a stale re-run.
    runKey: `destination:${destination.id}`,
    runFn: () => runResearch(db, destination),
  });
}
