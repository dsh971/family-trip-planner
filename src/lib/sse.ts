// Shared SSE framing helpers for the research routes
// (src/app/api/destinations/[id]/research/route.ts,
// src/app/api/neighborhoods/[id]/research/route.ts). Extracted per code
// review (ce-code-review, 2026-08-21) — sseEncode was already duplicated
// verbatim between both routes, and adding sseErrorResponse (also fixing a
// P1 finding: pre-flight rejections need SSE framing so useResearchStream's
// EventSource client can read them as a named error event instead of a
// generic connection failure) would have made it a third near-identical
// copy in each file.

export function sseEncode(encoder: TextEncoder, event: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// A one-frame SSE response used for pre-flight rejections (rate limit,
// invalid id, not found). The HTTP transport always succeeds (200,
// text/event-stream) and the real status lives in the named "error" event's
// payload — see the two research routes' GET handlers for why this matters
// to EventSource clients specifically.
export function sseErrorResponse(message: string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(sseEncode(encoder, "error", { message }));
      controller.close();
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
