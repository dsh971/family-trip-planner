import { startOrJoin } from "./orchestrator";
import { sseEncode } from "@/lib/sse";

// Shared SSE response builder for the U5/U6 research routes
// (src/app/api/destinations/[id]/research/route.ts,
// src/app/api/neighborhoods/[id]/research/route.ts). Extracted per code
// review (ce-code-review, 2026-08-21, maintainability P2) — the two routes'
// GET handlers were near-byte-for-byte identical past their cached-path
// condition and startOrJoin call: same outer try/catch, same startOrJoin
// loop, same done/partial/error terminal event shapes, same Response
// construction. Only the entity-specific bits are left as parameters:
// whether/how to stream the cached path, and the run key/generator for the
// live path. This does NOT try to unify the two routes' actual differences
// (destinations' `force` flag and fire-and-forget WG sync live in that
// route's own isCached/streamCached callbacks, not here) — forcing those
// into a shared config would trade real duplication for false genericity.
export function buildResearchSSEResponse<Event extends { type: string }>(options: {
  isCached: boolean;
  streamCached: (enqueue: (event: string, data: unknown) => void) => void;
  runKey: string;
  runFn: () => AsyncGenerator<Event>;
}): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function enqueue(event: string, data: unknown) {
        controller.enqueue(sseEncode(encoder, event, data));
      }

      try {
        // Cached/fresh path (R7, AE2): stream already-persisted data
        // immediately. Still shaped as SSE events for a consistent client
        // contract, but with no research run and no wait state.
        if (options.isCached) {
          options.streamCached(enqueue);
          enqueue("done", { researchStatus: "complete" });
          controller.close();
          return;
        }

        // Otherwise: not_started, in_progress, partial, or stale-complete —
        // all treated as "run (or join) research" per the state machine in
        // the rewrite's High-Level Technical Design.
        const events = startOrJoin(options.runKey, options.runFn);

        try {
          for await (const event of events) {
            enqueue(event.type, event);
          }
          enqueue("done", { researchStatus: "complete" });
        } catch (err) {
          // The run function already called markPartial before rethrowing
          // (see each route's runResearch) — this catch only needs to
          // surface the terminal SSE event to whichever subscriber
          // (original caller or joiner) is reading this stream.
          enqueue("partial", {
            researchStatus: "partial",
            error: err instanceof Error ? err.message : String(err),
          });
        }
        controller.close();
      } catch (err) {
        // Unexpected failure outside the research generator itself (e.g. a
        // DB error reading the cached path) — close the stream with an
        // explicit error event rather than hanging the connection open.
        enqueue("error", { message: err instanceof Error ? err.message : String(err) });
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
