import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useResearchStream } from "./useResearchStream";

// jsdom has no EventSource implementation, and the codebase has no existing
// browser-API mock convention to extend (no ResizeObserver/EventSource
// stubs in src/test/setup.ts) — this is a small, purpose-built test double
// that only implements what the hook actually touches: addEventListener per
// named event, an assignable `onerror`, and `close()`. Kept intentionally
// minimal per this unit's testing guidance (no full EventSource spec).
class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  closed = false;
  onerror: ((evt: unknown) => void) | null = null;
  private listeners = new Map<string, Array<(evt: unknown) => void>>();

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(name: string, handler: (evt: unknown) => void) {
    const arr = this.listeners.get(name) ?? [];
    arr.push(handler);
    this.listeners.set(name, arr);
  }

  close() {
    this.closed = true;
  }

  // --- test helpers -----------------------------------------------------

  /** Simulate the server emitting a named SSE event (event: name / data: json). */
  emit(name: string, data: unknown) {
    const payload = { data: JSON.stringify(data) };
    for (const handler of this.listeners.get(name) ?? []) handler(payload);
    if (name === "error" || name === "done" || name === "partial") return;
  }

  /** Simulate the server's own terminal `event: error` frame (a MessageEvent, has .data). */
  emitNamedError(data: { message?: string }) {
    const payload = { data: JSON.stringify(data) };
    this.onerror?.(payload);
  }

  /** Simulate a genuine connection-level failure (a plain Event, no .data). */
  emitConnectionError() {
    this.onerror?.({});
  }
}

function createEventSource(url: string): EventSource {
  return new MockEventSource(url) as unknown as EventSource;
}

function latestInstance(): MockEventSource {
  const inst = MockEventSource.instances[MockEventSource.instances.length - 1];
  if (!inst) throw new Error("no MockEventSource instance created");
  return inst;
}

afterEach(() => {
  MockEventSource.instances = [];
  vi.restoreAllMocks();
});

describe("useResearchStream", () => {
  it("accumulates a sequence of SSE events into items in arrival order", async () => {
    const { result } = renderHook(() =>
      useResearchStream("/api/neighborhoods/1/research", {
        itemEventNames: ["place"],
        createEventSource,
      })
    );

    expect(result.current.status).toBe("researching");

    act(() => {
      latestInstance().emit("place", { name: "Ramen shop" });
    });
    act(() => {
      latestInstance().emit("place", { name: "Park" });
    });

    expect(result.current.items.map((i) => (i.data as { name: string }).name)).toEqual([
      "Ramen shop",
      "Park",
    ]);
  });

  it("settles to complete on done", async () => {
    const { result } = renderHook(() =>
      useResearchStream("/api/neighborhoods/1/research", {
        itemEventNames: ["place"],
        createEventSource,
      })
    );

    act(() => {
      latestInstance().emit("place", { name: "Ramen shop" });
      latestInstance().emit("done", { researchStatus: "complete" });
    });

    await waitFor(() => expect(result.current.status).toBe("complete"));
    expect(result.current.items).toHaveLength(1);
  });

  it("settles to partial and keeps already-resolved items when items exist", async () => {
    const { result } = renderHook(() =>
      useResearchStream("/api/neighborhoods/1/research", {
        itemEventNames: ["place"],
        createEventSource,
      })
    );

    act(() => {
      latestInstance().emit("place", { name: "Ramen shop" });
      latestInstance().emit("partial", { researchStatus: "partial", error: "source failed" });
    });

    await waitFor(() => expect(result.current.status).toBe("partial"));
    expect(result.current.items).toHaveLength(1);
  });

  it("a run that resolves zero items before failing settles to error, not partial", async () => {
    const { result } = renderHook(() =>
      useResearchStream("/api/neighborhoods/1/research", {
        itemEventNames: ["place"],
        createEventSource,
      })
    );

    act(() => {
      latestInstance().emit("partial", { researchStatus: "partial", error: "nothing resolved" });
    });

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.errorMessage).toBe("nothing resolved");
    expect(result.current.items).toHaveLength(0);
  });

  it("the route's terminal error event settles to error with a message", async () => {
    const { result } = renderHook(() =>
      useResearchStream("/api/neighborhoods/1/research", {
        itemEventNames: ["place"],
        createEventSource,
      })
    );

    act(() => {
      latestInstance().emitNamedError({ message: "DB error" });
    });

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.errorMessage).toBe("DB error");
  });

  it("exceeding the retry cap after repeated connection drops settles to error with a retry action available", async () => {
    const { result } = renderHook(() =>
      useResearchStream("/api/neighborhoods/1/research", {
        itemEventNames: ["place"],
        createEventSource,
        maxRetries: 2,
      })
    );

    act(() => {
      latestInstance().emitConnectionError(); // attempt 1
    });
    act(() => {
      latestInstance().emitConnectionError(); // attempt 2
    });
    act(() => {
      latestInstance().emitConnectionError(); // exceeds cap
    });

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(typeof result.current.retry).toBe("function");
    // Three drops => the hook opened one initial connection plus one fresh
    // reconnect per recoverable drop (2, since maxRetries=2), for 3 total.
    expect(MockEventSource.instances).toHaveLength(3);
  });

  it("a recoverable mid-stream connection drop triggers a fresh reconnect and ends in a non-error terminal status", async () => {
    const { result } = renderHook(() =>
      useResearchStream("/api/neighborhoods/1/research", {
        itemEventNames: ["place"],
        createEventSource,
        maxRetries: 3,
      })
    );

    act(() => {
      latestInstance().emit("place", { name: "Ramen shop" });
    });
    expect(result.current.items).toHaveLength(1);

    act(() => {
      latestInstance().emitConnectionError();
    });

    // A fresh EventSource was opened, and the local item buffer was reset
    // in favor of whatever the fresh connection replays (server backfill).
    expect(MockEventSource.instances).toHaveLength(2);
    expect(result.current.status).toBe("researching");

    act(() => {
      latestInstance().emit("place", { name: "Ramen shop" });
      latestInstance().emit("place", { name: "Park" });
      latestInstance().emit("done", { researchStatus: "complete" });
    });

    await waitFor(() => expect(result.current.status).toBe("complete"));
    expect(result.current.status).not.toBe("error");
    expect(result.current.items).toHaveLength(2);
  });

  it("retry() re-opens a fresh connection and resets state", async () => {
    const { result } = renderHook(() =>
      useResearchStream("/api/neighborhoods/1/research", {
        itemEventNames: ["place"],
        createEventSource,
        maxRetries: 0,
      })
    );

    act(() => {
      latestInstance().emitConnectionError();
    });
    await waitFor(() => expect(result.current.status).toBe("error"));

    act(() => {
      result.current.retry();
    });

    await waitFor(() => expect(result.current.status).toBe("researching"));
    expect(MockEventSource.instances).toHaveLength(2);
    expect(result.current.items).toHaveLength(0);
    expect(result.current.errorMessage).toBeNull();
  });

  it("does not connect when url is null", () => {
    const { result } = renderHook(() =>
      useResearchStream(null, { itemEventNames: ["place"], createEventSource })
    );
    expect(result.current.status).toBe("not_started");
    expect(MockEventSource.instances).toHaveLength(0);
  });
});
