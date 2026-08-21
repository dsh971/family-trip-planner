"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// U7 (plan 2026-08-20-011): shared client hook for consuming the U5/U6 SSE
// research routes (src/app/api/destinations/[id]/research/route.ts and
// src/app/api/neighborhoods/[id]/research/route.ts). Both routes emit named
// SSE events — one or more "item" event types specific to the stage
// (destination route: "highlight" then "neighborhood"; neighborhood route:
// "place") plus three shared terminal event types: "done" (fully resolved),
// "partial" (some items resolved, then a source failure cut the run short —
// items already streamed are kept per the plan's "partial results are kept
// and rendered, not discarded on failure" KTD), and "error" (the route
// failed before/without producing any usable stream, e.g. a DB error on the
// cached-read path). This hook is deliberately generic over which "item"
// event names count as content so both consuming pages can share one
// implementation instead of two near-duplicates.

export type ResearchStatus =
  | "not_started"
  | "researching"
  | "complete"
  | "partial"
  | "error";

export interface ResearchStreamItem<T = unknown> {
  /** The SSE event name this item arrived under (e.g. "neighborhood", "place", "highlight"). */
  type: string;
  data: T;
}

export interface UseResearchStreamOptions {
  /** SSE event names that represent content to accumulate into `items`, in server-emitted order. */
  itemEventNames: string[];
  /** Reconnect attempts allowed after a dropped connection before settling into "error". Default 3. */
  maxRetries?: number;
  /** Test/DI seam — defaults to the real `EventSource` constructor. */
  createEventSource?: (url: string) => EventSource;
}

export interface UseResearchStreamResult<T = unknown> {
  items: ResearchStreamItem<T>[];
  status: ResearchStatus;
  /** Populated when status is "error" (including a "partial" run that resolved zero items — treated as "error"). */
  errorMessage: string | null;
  /** Re-opens the connection from scratch (resets retry count and items). Backs the UI's error-state retry action. */
  retry: () => void;
}

const DEFAULT_MAX_RETRIES = 3;

export function useResearchStream<T = unknown>(
  url: string | null,
  options: UseResearchStreamOptions
): UseResearchStreamResult<T> {
  const { itemEventNames, maxRetries = DEFAULT_MAX_RETRIES, createEventSource } = options;

  const [items, setItems] = useState<ResearchStreamItem<T>[]>([]);
  const [status, setStatus] = useState<ResearchStatus>("not_started");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Mirrors `items` synchronously (state updates are async) so the "zero
  // items before failing => error, not partial" rule and reconnect resets
  // can read the current count without racing React's batching.
  const itemsRef = useRef<ResearchStreamItem<T>[]>([]);
  const attemptsRef = useRef(0);
  // True once a terminal event (done/partial/error) has been handled, so a
  // subsequent native `onerror` (e.g. the server closing the stream right
  // after a terminal event) is ignored instead of triggering a reconnect.
  const terminalRef = useRef(false);
  const itemEventNamesRef = useRef(itemEventNames);
  // Kept current via an effect (not a direct render-time write) so a
  // connection already open reads whatever `itemEventNames` a caller most
  // recently passed without needing to be in the connect effect's own
  // dependency array (which would otherwise force a reconnect any time a
  // caller passes a fresh array literal, even with the same contents).
  useEffect(() => {
    itemEventNamesRef.current = itemEventNames;
  }, [itemEventNames]);

  // Bumping this forces the connect effect to tear down and reopen a fresh
  // connection even when `url` itself hasn't changed — backs manual retry().
  const [retryToken, setRetryToken] = useState(0);

  const retry = useCallback(() => {
    attemptsRef.current = 0;
    terminalRef.current = false;
    itemsRef.current = [];
    setItems([]);
    setErrorMessage(null);
    setStatus("not_started");
    setRetryToken((t) => t + 1);
  }, []);

  useEffect(() => {
    if (!url) {
      setStatus("not_started");
      return;
    }

    let cancelled = false;
    let currentEs: EventSource | null = null;

    terminalRef.current = false;
    itemsRef.current = [];
    setItems([]);
    setErrorMessage(null);
    setStatus("researching");

    function pushItem(eventName: string, raw: string) {
      let parsed: T;
      try {
        parsed = JSON.parse(raw) as T;
      } catch {
        return;
      }
      itemsRef.current = [...itemsRef.current, { type: eventName, data: parsed }];
      setItems(itemsRef.current);
    }

    function settleTerminalError(message: string) {
      terminalRef.current = true;
      setStatus("error");
      setErrorMessage(message);
    }

    function connect() {
      const es = createEventSource ? createEventSource(url as string) : new EventSource(url as string);
      currentEs = es;

      for (const eventName of itemEventNamesRef.current) {
        es.addEventListener(eventName, (evt) => {
          if (cancelled) return;
          pushItem(eventName, (evt as MessageEvent).data as string);
        });
      }

      es.addEventListener("done", () => {
        if (cancelled) return;
        terminalRef.current = true;
        es.close();
        setStatus("complete");
      });

      es.addEventListener("partial", (evt) => {
        if (cancelled) return;
        terminalRef.current = true;
        es.close();
        let message = "Some results couldn't be loaded.";
        try {
          const parsed = JSON.parse((evt as MessageEvent).data as string) as { error?: string };
          if (parsed.error) message = parsed.error;
        } catch {
          // keep default message
        }
        // A run that resolved zero items before failing is indistinguishable
        // from "nothing has arrived yet" if left as "partial" — surfaced as
        // "error" instead, per this unit's Approach.
        if (itemsRef.current.length === 0) {
          settleTerminalError(message);
        } else {
          setStatus("partial");
        }
      });

      // A single `onerror` handler covers two very different cases that
      // EventSource delivers through the identical "error" channel:
      //  1. The route's own explicit terminal `event: error` SSE frame (an
      //     unexpected failure before/without streaming any items) — this
      //     arrives as a MessageEvent with a string `.data` payload.
      //  2. A genuine connection-level failure (network drop, server
      //     unreachable, response ended unexpectedly) — this arrives as a
      //     plain Event with no `.data`.
      // Disambiguating by payload shape is the only reliable way to tell
      // them apart, since both surface as an "error"-typed event on the
      // same EventSource instance.
      es.onerror = (evt) => {
        if (cancelled) return;
        const maybeMessage = evt as MessageEvent;
        const isNamedErrorFrame = typeof maybeMessage.data === "string";

        if (isNamedErrorFrame) {
          if (terminalRef.current) return;
          es.close();
          let message = "Research failed.";
          try {
            const parsed = JSON.parse(maybeMessage.data as string) as { message?: string };
            if (parsed.message) message = parsed.message;
          } catch {
            // keep default
          }
          settleTerminalError(message);
          return;
        }

        // Genuine connection failure. Ignore if we already reached a
        // terminal state (done/partial/error) via a normal event — the
        // server closing the stream right after that can itself surface as
        // a connection error, which isn't a drop to recover from.
        if (terminalRef.current) return;
        es.close();

        if (attemptsRef.current >= maxRetries) {
          settleTerminalError("Couldn't reconnect. Please try again.");
          return;
        }
        attemptsRef.current += 1;
        // Per this unit's Approach: don't rely on EventSource's native
        // reconnect/replay — close and open a fresh connection instead. The
        // server's startOrJoin backfill (or its cached-read fast path)
        // naturally recovers whatever state existed, so resetting the local
        // item buffer here and letting the fresh connection repopulate it
        // is correct, not lossy.
        itemsRef.current = [];
        setItems([]);
        connect();
      };
    }

    connect();

    return () => {
      cancelled = true;
      currentEs?.close();
      currentEs = null;
    };
  }, [url, retryToken, maxRetries, createEventSource]);

  return { items, status, errorMessage, retry };
}
