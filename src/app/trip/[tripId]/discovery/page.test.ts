import { describe, it, expect } from "vitest";

function corroborationToSignal(score: number): string | null {
  if (score === 0) return null;
  if (score === 1) return "Trending locally";
  return "Highly recommended locally";
}

function metersToMinutes(meters: number): string {
  return `~${Math.max(5, Math.round(meters / 80 / 5) * 5)}-min walk`;
}

describe("corroborationToSignal", () => {
  it("score 0 → null", () => expect(corroborationToSignal(0)).toBeNull());
  it("score 1 → 'Trending locally'", () => expect(corroborationToSignal(1)).toBe("Trending locally"));
  it("score 2 → 'Highly recommended locally'", () => expect(corroborationToSignal(2)).toBe("Highly recommended locally"));
  it("score 5 → 'Highly recommended locally'", () => expect(corroborationToSignal(5)).toBe("Highly recommended locally"));
});

describe("metersToMinutes", () => {
  it("1200m → ~15-min walk", () => expect(metersToMinutes(1200)).toBe("~15-min walk"));
  it("200m → ~5-min walk (minimum floor)", () => expect(metersToMinutes(200)).toBe("~5-min walk"));
});
