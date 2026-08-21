import { describe, it, expect, vi } from "vitest";
import { withConcurrencyLimit } from "./concurrency";

describe("withConcurrencyLimit", () => {
  it("calls fn exactly once per item", async () => {
    const items = [1, 2, 3, 4, 5];
    const fn = vi.fn().mockResolvedValue(undefined);

    await withConcurrencyLimit(items, fn, 2);

    expect(fn).toHaveBeenCalledTimes(5);
    const calledWith = fn.mock.calls.map((call) => call[0]).sort();
    expect(calledWith).toEqual(items);
  });

  it("never runs more than `limit` items concurrently", async () => {
    const items = [1, 2, 3, 4, 5, 6, 7];
    let inFlight = 0;
    let maxInFlight = 0;

    const fn = vi.fn(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
    });

    await withConcurrencyLimit(items, fn, 3);

    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(maxInFlight).toBeGreaterThan(1); // sanity: actually ran some in parallel
  });

  it("processes items in chunks, waiting for each chunk to settle before starting the next", async () => {
    const items = [1, 2, 3, 4];
    const order: string[] = [];

    const fn = vi.fn(async (item: number) => {
      order.push(`start:${item}`);
      await new Promise((resolve) => setTimeout(resolve, item === 1 ? 10 : 1));
      order.push(`end:${item}`);
    });

    await withConcurrencyLimit(items, fn, 2);

    // Chunk 1 = [1, 2], chunk 2 = [3, 4]. Both items in chunk 1 must start
    // before either item in chunk 2 starts, since chunk 2 only begins once
    // Promise.all for chunk 1 has resolved.
    const chunk2StartIndex = order.indexOf("start:3");
    const chunk1EndIndices = [order.indexOf("end:1"), order.indexOf("end:2")];
    expect(chunk1EndIndices.every((i) => i < chunk2StartIndex)).toBe(true);
  });

  it("handles an empty items array without error", async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    await withConcurrencyLimit([], fn, 4);
    expect(fn).not.toHaveBeenCalled();
  });

  it("propagates a rejection from fn", async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue(undefined);
    await expect(withConcurrencyLimit([1, 2], fn, 2)).rejects.toThrow("boom");
  });
});
