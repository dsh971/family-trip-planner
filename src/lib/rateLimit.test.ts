import { describe, it, expect, vi } from "vitest";
import { createRateLimiter } from "./rateLimit";

describe("createRateLimiter", () => {
  it("allows requests up to maxRequests, then rejects", () => {
    const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 3 });

    expect(limiter.isRateLimited()).toBe(false);
    expect(limiter.isRateLimited()).toBe(false);
    expect(limiter.isRateLimited()).toBe(false);
    expect(limiter.isRateLimited()).toBe(true);
  });

  it("resets the window after windowMs elapses, allowing requests again", () => {
    vi.useFakeTimers();
    try {
      const limiter = createRateLimiter({ windowMs: 1000, maxRequests: 1 });

      expect(limiter.isRateLimited()).toBe(false);
      expect(limiter.isRateLimited()).toBe(true);

      vi.advanceTimersByTime(1000);

      expect(limiter.isRateLimited()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reset() clears state within the same window", () => {
    const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 1 });

    expect(limiter.isRateLimited()).toBe(false);
    expect(limiter.isRateLimited()).toBe(true);

    limiter.reset();

    expect(limiter.isRateLimited()).toBe(false);
  });

  it("independent limiter instances do not share state", () => {
    const a = createRateLimiter({ windowMs: 60_000, maxRequests: 1 });
    const b = createRateLimiter({ windowMs: 60_000, maxRequests: 1 });

    expect(a.isRateLimited()).toBe(false);
    expect(a.isRateLimited()).toBe(true);

    // b's own budget is untouched by a's usage — each createRateLimiter()
    // call must own independent state (one per route), even though neither
    // exposes a per-caller key.
    expect(b.isRateLimited()).toBe(false);
  });
});
