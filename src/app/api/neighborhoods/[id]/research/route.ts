import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { destinations, neighborhoods, places, type Destination, type Neighborhood } from "@/db/schema";
import {
  startOrJoin,
  isStale,
  markInProgress,
  markComplete,
  markPartial,
} from "@/services/research/orchestrator";
import {
  researchNeighborhoodPlaces,
  createResearchAccumulators,
  placeRowToCandidateBase,
  finalizeDistances,
} from "@/services/discovery/research";
import type { DiscoveryCandidate } from "@/services/discovery/filters";

// U6 (plan 2026-08-20-011): SSE endpoint that runs (or joins) a
// neighborhood's place-research pass and streams results as they resolve —
// GET only, since EventSource can't use other verbs. By the time this route
// runs for a given neighborhood, U5 has already synced that neighborhood's
// destination's Wanderlust-Goat city data if it was that destination's
// first research pass — this route doesn't do any sync-city handling of its
// own (see src/app/api/destinations/[id]/research/route.ts).

type Db = ReturnType<typeof getDb>;

// --- Per-IP rate limiting -----------------------------------------------
// Mirrors src/app/api/destinations/[id]/research/route.ts's GET rate
// limiter exactly (same simple in-memory fixed-window counter, same
// rationale: unauthenticated, GET-only because EventSource requires it, and
// can trigger real external API cost via the research pass it (re)joins).
// Kept as its own module-local counter, same as that sibling route — no
// shared rate-limit module exists yet in this codebase.
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

// Test-only escape hatch, mirroring src/app/api/destinations/[id]/research/route.ts.
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

interface PlaceEvent {
  type: "place";
  neighborhoodId: number;
  place: DiscoveryCandidate;
}

// The run function passed to orchestrator.startOrJoin. Only the winning
// caller's closure for a given key ever actually executes this (see
// orchestrator.ts's startOrJoin) — joiners subscribe to its output instead,
// so markInProgress below only ever runs once per research run, even under
// a concurrent-join race.
//
// Error handling mirrors the exact convention U5's route.ts already
// establishes: on failure, call markPartial and RETHROW (don't swallow) —
// orchestrator's subscribe() replays every already-buffered item to each
// subscriber before re-surfacing the error, so nothing already resolved is
// lost (plan KTD: "partial results are kept and rendered, not discarded on
// failure"). researchNeighborhoodPlaces itself already yields incrementally
// per place, so a mid-pass failure there naturally leaves every
// already-yielded (and already-persisted) candidate in the subscriber's
// buffer — the calling route below is what turns the rethrown error into a
// terminal "partial" SSE event instead of an unhandled rejection.
async function* runResearch(
  db: Db,
  neighborhood: Neighborhood,
  destination: Destination
): AsyncGenerator<PlaceEvent> {
  markInProgress(db, { kind: "neighborhood", id: neighborhood.id });

  const acc = createResearchAccumulators();

  try {
    for await (const candidate of researchNeighborhoodPlaces(db, neighborhood, destination, acc)) {
      yield { type: "place", neighborhoodId: neighborhood.id, place: candidate };
    }
  } catch (err) {
    markPartial(db, { kind: "neighborhood", id: neighborhood.id });
    throw err;
  }

  markComplete(db, { kind: "neighborhood", id: neighborhood.id });
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
    return NextResponse.json({ error: "Invalid neighborhood id" }, { status: 400 });
  }

  const db = getDb();
  const neighborhood = db.select().from(neighborhoods).where(eq(neighborhoods.id, id)).all()[0];
  if (!neighborhood) {
    return NextResponse.json({ error: "Neighborhood not found" }, { status: 404 });
  }

  const destination = db
    .select()
    .from(destinations)
    .where(eq(destinations.id, neighborhood.destinationId))
    .all()[0];
  if (!destination) {
    return NextResponse.json({ error: "Destination not found" }, { status: 404 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Cached/fresh path (R7, AE2): complete and not stale — stream the
        // already-persisted places immediately. Still shaped as SSE events
        // for a consistent client contract, but with no research run and no
        // wait state.
        if (neighborhood.researchStatus === "complete" && !isStale(neighborhood.researchedAt)) {
          const existing = db.select().from(places).where(eq(places.neighborhoodId, neighborhood.id)).all();
          const finalized = finalizeDistances(existing.map(placeRowToCandidateBase), neighborhood);
          for (const place of finalized) {
            controller.enqueue(
              sseEncode(encoder, "place", { type: "place", neighborhoodId: neighborhood.id, place })
            );
          }
          controller.enqueue(sseEncode(encoder, "done", { researchStatus: "complete" }));
          controller.close();
          return;
        }

        // Otherwise: not_started, in_progress, partial, or stale-complete —
        // all treated as "run (or join) research," mirroring U5's route.
        const runKey = `neighborhood:${neighborhood.id}`;
        const events = startOrJoin(runKey, () => runResearch(db, neighborhood, destination));

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
        // DB error reading the cached-path places) — close the stream with
        // an explicit error event rather than hanging the connection open.
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
