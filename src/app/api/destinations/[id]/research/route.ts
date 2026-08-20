import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { destinations, neighborhoods, type Destination, type Neighborhood } from "@/db/schema";
import {
  startOrJoin,
  isStale,
  markInProgress,
  markComplete,
  markPartial,
} from "@/services/research/orchestrator";
import { syncCity } from "@/services/wanderlust-goat/client";
import {
  generateDestinationHighlight,
  discoverNeighborhoods,
  type NeighborhoodCandidate,
} from "@/services/neighborhoods/discover";

// U5 (plan 2026-08-20-011): SSE endpoint that runs (or joins) a
// destination's neighborhood-discovery research pass and streams results as
// they resolve — GET only, since EventSource can't use other verbs.

type Db = ReturnType<typeof getDb>;

// --- Per-IP rate limiting -----------------------------------------------
// Mirrors src/app/api/destinations/route.ts's POST rate limiter exactly
// (same simple in-memory fixed-window counter, same rationale: this route
// is unauthenticated, GET-only because EventSource requires it, and can
// trigger real external API cost via the research pass it (re)joins). Kept
// as its own module-local counter rather than extracted into a shared
// helper — no shared rate-limit module exists yet in this codebase, and the
// plan's file list for this unit doesn't add one; duplicating the same
// simple pattern is "reuse the approach," not "reinvent a new one."
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 10;

const rateLimitState = new Map<string, { count: number; windowStart: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitState.get(ip);
  if (!entry || now - entry.windowStart >= RATE_LIMIT_WINDOW_MS) {
    rateLimitState.set(ip, { count: 1, windowStart: now });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT_MAX_REQUESTS;
}

// Test-only escape hatch, mirroring src/app/api/destinations/route.ts.
export function _resetRateLimitForTesting(): void {
  rateLimitState.clear();
}

function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]!.trim();
  }
  return "unknown";
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

// The run function passed to orchestrator.startOrJoin. Only the winning
// caller's closure for a given key ever actually executes this (see
// orchestrator.ts's startOrJoin) — joiners subscribe to its output instead,
// so syncCity/markInProgress below only ever run once per research run,
// even under a concurrent-join race.
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
  // Only "not_started" triggers syncCity — a stale-but-complete or partial
  // destination has already been synced once; re-syncing it would repay the
  // 2-5 minute cost for no benefit (plan Approach step 2/6).
  const isFirstResearch = destination.researchStatus === "not_started";

  markInProgress(db, { kind: "destination", id: destination.id });

  if (isFirstResearch) {
    try {
      await syncCity(destination.name, destination.country);
    } catch (err) {
      // sync-city failure degrades WG corroboration quality for this
      // destination (KTD-J) but doesn't block neighborhood discovery, which
      // doesn't depend on WG in this unit at all — logged, not fatal, per
      // this codebase's existing "WG unavailable → degrade gracefully"
      // convention (src/app/api/discovery/route.ts's wgInstalled handling).
      console.warn(
        `[Research] sync-city failed for ${destination.name}, ${destination.country}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  // Highlight-first: emitted before any neighborhood event, per this plan's
  // Key Technical Decision ("emitted first ... so it's available for the
  // entire wait, not just whatever's left of it").
  yield {
    type: "highlight",
    destinationId: destination.id,
    text: generateDestinationHighlight(destination),
  };

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

function sseEncode(encoder: TextEncoder, event: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ip = getClientIp(request);
  if (isRateLimited(ip)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Invalid destination id" }, { status: 400 });
  }

  const db = getDb();
  const destination = db.select().from(destinations).where(eq(destinations.id, id)).all()[0];
  if (!destination) {
    return NextResponse.json({ error: "Destination not found" }, { status: 404 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Cached/fresh path (R7, AE2): complete and not stale — stream the
        // already-persisted neighborhoods immediately. Still shaped as SSE
        // events for a consistent client contract, but with no research run
        // and no wait state.
        if (destination.researchStatus === "complete" && !isStale(destination.researchedAt)) {
          const existing = db
            .select()
            .from(neighborhoods)
            .where(eq(neighborhoods.destinationId, destination.id))
            .all();
          for (const n of existing) {
            controller.enqueue(sseEncode(encoder, "neighborhood", { type: "neighborhood", neighborhood: n }));
          }
          controller.enqueue(sseEncode(encoder, "done", { researchStatus: "complete" }));
          controller.close();
          return;
        }

        // Otherwise: not_started, in_progress, partial, or stale-complete —
        // all treated as "run (or join) research" per the state machine in
        // this plan's High-Level Technical Design. Stale-complete is
        // deliberately routed through the same path as not_started EXCEPT
        // for syncCity, which runResearch's own isFirstResearch check
        // already gates on researchStatus === "not_started" specifically.
        const runKey = `destination:${destination.id}`;
        const events = startOrJoin(runKey, () => runResearch(db, destination));

        try {
          for await (const event of events) {
            controller.enqueue(sseEncode(encoder, event.type, event));
          }
          controller.enqueue(sseEncode(encoder, "done", { researchStatus: "complete" }));
        } catch (err) {
          // runResearch already called markPartial before rethrowing — this
          // catch only needs to surface the terminal SSE event to whichever
          // subscriber (original caller or joiner) is reading this stream.
          controller.enqueue(
            sseEncode(encoder, "partial", {
              researchStatus: "partial",
              error: err instanceof Error ? err.message : String(err),
            })
          );
        }
        controller.close();
      } catch (err) {
        // Unexpected failure outside the research generator itself (e.g. a
        // DB error reading the cached-path neighborhoods) — close the
        // stream with an explicit error event rather than hanging the
        // connection open.
        controller.enqueue(
          sseEncode(encoder, "error", { message: err instanceof Error ? err.message : String(err) })
        );
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
