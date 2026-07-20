import { describe, it, expect } from "vitest";
import {
  tokenOverlap,
  namesMatch,
  buildSources,
  corroborationScore,
} from "./corroboration";

describe("tokenOverlap", () => {
  it("returns >= 0.6 for hyphenated name vs expanded form", () => {
    // "Musashino-en" → ["musashino", "en"]
    // "Musashino En Garden" → ["musashino", "en", "garden"]
    // shorter = ["musashino", "en"], both appear in longer → 2/2 = 1.0
    expect(tokenOverlap("Musashino-en", "Musashino En Garden")).toBeGreaterThanOrEqual(0.6);
  });

  it("returns < 0.6 for completely different names", () => {
    expect(tokenOverlap("Ramen ABC", "Tonkotsu House")).toBeLessThan(0.6);
  });

  it("returns 0 (not NaN) for non-Latin-script input", () => {
    const result = tokenOverlap("むさしの園", "Musashino-en");
    expect(result).toBe(0);
    expect(Number.isNaN(result)).toBe(false);
  });
});

describe("namesMatch", () => {
  it("returns true when multi-token names overlap >= 60%", () => {
    expect(namesMatch("Kichijoji Curry", "Kichijoji Curry House")).toBe(true);
  });

  it("returns false when multi-token names share no tokens", () => {
    expect(namesMatch("Ramen Nagi", "Soba Nishi")).toBe(false);
  });

  it("requires exact match for single-token names (false positive guard)", () => {
    // "Nagi" (1 token) vs "Nagi Ramen" (2 tokens) — single-token guard fires
    // exact normalized match: "nagi" !== "nagi ramen" → false
    expect(namesMatch("Nagi", "Nagi Ramen")).toBe(false);
  });

  it("returns true for exact single-token match", () => {
    expect(namesMatch("Ippudo", "Ippudo")).toBe(true);
  });
});

describe("buildSources", () => {
  it("includes wanderlust-goat when a WG name matches", () => {
    expect(buildSources("Musashino-en", ["Musashino En"], [])).toEqual([
      "google-places-text-search",
      "wanderlust-goat",
    ]);
  });

  it("returns only google-places-text-search when no WG name matches", () => {
    expect(buildSources("Ramen Nagi", ["Tonkotsu House"], [])).toEqual([
      "google-places-text-search",
    ]);
  });

  it("returns only google-places-text-search when both wgNames and tabelogNames are empty", () => {
    expect(buildSources("Ramen Nagi", [], [])).toEqual([
      "google-places-text-search",
    ]);
  });

  it("returns score 2 when only wgNames matches", () => {
    const sources = buildSources("Ramen Nagi", ["Ramen Nagi"], []);
    expect(sources).toContain("wanderlust-goat");
    expect(sources).toHaveLength(2);
  });

  it("returns all three sources (score 3) when both wgNames and tabelogNames match", () => {
    expect(buildSources("Ramen Nagi", ["Ramen Nagi"], ["Ramen Nagi"])).toEqual([
      "google-places-text-search",
      "wanderlust-goat",
      "tabelog",
    ]);
  });

  it("includes tabelog but not wanderlust-goat when only tabelogNames matches", () => {
    const sources = buildSources("Ramen Nagi", [], ["Ramen Nagi"]);
    expect(sources).toContain("tabelog");
    expect(sources).not.toContain("wanderlust-goat");
    expect(sources).toEqual(["google-places-text-search", "tabelog"]);
  });

  it("includes tabelog but not wanderlust-goat when wgNames does not match", () => {
    const sources = buildSources("Ramen Nagi", ["Unrelated Place"], ["Ramen Nagi"]);
    expect(sources).toContain("tabelog");
    expect(sources).not.toContain("wanderlust-goat");
  });
});

describe("corroborationScore", () => {
  it("returns 2 when both sources present", () => {
    expect(
      corroborationScore(["google-places-text-search", "wanderlust-goat"])
    ).toBe(2);
  });

  it("returns 1 when only google-places-text-search present", () => {
    expect(corroborationScore(["google-places-text-search"])).toBe(1);
  });

  it("returns 3 when all three sources present", () => {
    expect(
      corroborationScore(["google-places-text-search", "wanderlust-goat", "tabelog"])
    ).toBe(3);
  });
});
