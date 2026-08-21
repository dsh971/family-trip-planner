// Shared per-route rate limiter. Originally each research route kept its
// own copy of this exact logic (plan 2026-08-20-011 U3/U5/U6) — extracted
// here per code review (ce-code-review, 2026-08-21) to fix duplication and,
// more importantly, to fix a real bypass: every copy keyed its bucket off
// the client-supplied X-Forwarded-For header, which is fully spoofable.
// This app runs as a bare Docker container via `next start` (see
// Dockerfile/scripts/entrypoint.sh) with no reverse proxy in front to
// validate or overwrite that header, and Next.js Route Handlers have no
// access to the raw socket address (the Request type is the Fetch API's,
// not Node's IncomingMessage) — so there is no unspoofable per-client
// identity available to key on here. Each limiter created by this module
// therefore tracks a single counter shared by every caller, rather than
// trusting request headers: coarser (one global budget per route instead
// of one per client), but not bypassable by rotating a header value. If
// this app is ever deployed behind a reverse proxy that unconditionally
// overwrites X-Forwarded-For, per-client keying can be reintroduced then —
// no route here currently has a use for it, so it isn't built in ahead of
// that need.

export interface RateLimiter {
  isRateLimited(): boolean;
  reset(): void;
}

export function createRateLimiter(options: {
  windowMs: number;
  maxRequests: number;
}): RateLimiter {
  let state: { count: number; windowStart: number } | null = null;

  return {
    isRateLimited(): boolean {
      const now = Date.now();
      if (!state || now - state.windowStart >= options.windowMs) {
        state = { count: 1, windowStart: now };
        return false;
      }
      state.count += 1;
      return state.count > options.maxRequests;
    },
    reset(): void {
      state = null;
    },
  };
}
