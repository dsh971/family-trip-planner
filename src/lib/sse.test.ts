import { describe, it, expect } from "vitest";
import { sseEncode, sseErrorResponse } from "./sse";

describe("sseEncode", () => {
  it("frames an event name and JSON-encoded data per the SSE wire format", () => {
    const encoder = new TextEncoder();
    const bytes = sseEncode(encoder, "neighborhood", { foo: "bar" });
    const text = new TextDecoder().decode(bytes);
    expect(text).toBe('event: neighborhood\ndata: {"foo":"bar"}\n\n');
  });
});

describe("sseErrorResponse", () => {
  it("returns a 200 text/event-stream response carrying a single named error event", async () => {
    // Status must be 200 (not the semantic error's real 4xx) — this is the
    // whole point of the helper: EventSource fails the connection outright
    // on a non-200/non-text-event-stream response, so the real error has to
    // travel inside a successfully-opened stream instead of the HTTP status.
    const res = sseErrorResponse("Too many requests");

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");

    const text = await res.text();
    expect(text).toBe('event: error\ndata: {"message":"Too many requests"}\n\n');
  });
});
