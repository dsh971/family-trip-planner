import { describe, it, expect } from "vitest";
import { getPlaceGradient } from "./placeGradient";

describe("getPlaceGradient", () => {
  it("returns a CSS linear-gradient string", () => {
    const result = getPlaceGradient("ChIJ_some_place_id");
    expect(result).toMatch(/^linear-gradient\(/);
  });

  it("is deterministic — the same seed always returns the same gradient", () => {
    const first = getPlaceGradient("ChIJ_musashino_ramen");
    const second = getPlaceGradient("ChIJ_musashino_ramen");
    expect(first).toBe(second);

    // Not a one-call fluke — repeat across many calls.
    for (let i = 0; i < 10; i++) {
      expect(getPlaceGradient("ChIJ_musashino_ramen")).toBe(first);
    }
  });

  it("different seeds can return different gradients", () => {
    const seeds = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const gradients = new Set(seeds.map((s) => getPlaceGradient(s)));
    // With 8 seeds over a 6-entry palette, at least 2 distinct gradients
    // should appear — this isn't a random function, so a real hash spread
    // is expected, not a constant return value.
    expect(gradients.size).toBeGreaterThan(1);
  });

  it("does not throw on an empty string", () => {
    expect(() => getPlaceGradient("")).not.toThrow();
    expect(getPlaceGradient("")).toMatch(/^linear-gradient\(/);
  });

  it("does not throw on null or undefined", () => {
    expect(() => getPlaceGradient(null)).not.toThrow();
    expect(() => getPlaceGradient(undefined)).not.toThrow();
    expect(getPlaceGradient(null)).toMatch(/^linear-gradient\(/);
    expect(getPlaceGradient(undefined)).toMatch(/^linear-gradient\(/);
  });

  it("empty, null, and undefined all resolve to the same fallback gradient", () => {
    const empty = getPlaceGradient("");
    expect(getPlaceGradient(null)).toBe(empty);
    expect(getPlaceGradient(undefined)).toBe(empty);
  });
});
