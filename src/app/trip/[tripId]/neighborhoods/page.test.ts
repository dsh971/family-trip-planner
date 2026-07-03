import { describe, it, expect } from "vitest";

// Import helpers by extracting them — they are defined inline in the page module.
// We duplicate the logic here to test it as pure functions.

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) / 10;
}

function metersToMinutes(meters: number): string {
  return `~${Math.max(5, Math.round(meters / 80 / 5) * 5)}-min walk`;
}

function scoreToLabel(score: number): string {
  if (score >= 90) return "Top pick for families";
  if (score >= 80) return "Excellent for families";
  if (score >= 70) return "Great for families";
  return "Good for families";
}

function formatChildrenAges(children: Array<{ age: number }>): string {
  if (children.length === 0) return "";
  const ages = children.map((c) => c.age);
  if (ages.length === 1) return `age ${ages[0]}`;
  const allButLast = ages.slice(0, -1).join(", ");
  return `ages ${allButLast} & ${ages[ages.length - 1]}`;
}

describe("metersToMinutes", () => {
  it("1200m → ~15-min walk", () => expect(metersToMinutes(1200)).toBe("~15-min walk"));
  it("1000m → ~15-min walk", () => expect(metersToMinutes(1000)).toBe("~15-min walk"));
  it("600m → ~10-min walk", () => expect(metersToMinutes(600)).toBe("~10-min walk"));
  it("500m → ~5-min walk", () => expect(metersToMinutes(500)).toBe("~5-min walk"));
  it("200m → minimum ~5-min walk (never less)", () => expect(metersToMinutes(200)).toBe("~5-min walk"));
  it("1500m → ~20-min walk", () => expect(metersToMinutes(1500)).toBe("~20-min walk"));
});

describe("scoreToLabel", () => {
  it("92 → Top pick for families", () => expect(scoreToLabel(92)).toBe("Top pick for families"));
  it("90 → Top pick for families (boundary)", () => expect(scoreToLabel(90)).toBe("Top pick for families"));
  it("89 → Excellent for families", () => expect(scoreToLabel(89)).toBe("Excellent for families"));
  it("85 → Excellent for families", () => expect(scoreToLabel(85)).toBe("Excellent for families"));
  it("80 → Excellent for families (boundary)", () => expect(scoreToLabel(80)).toBe("Excellent for families"));
  it("74 → Great for families", () => expect(scoreToLabel(74)).toBe("Great for families"));
  it("70 → Great for families (boundary)", () => expect(scoreToLabel(70)).toBe("Great for families"));
  it("60 → Good for families", () => expect(scoreToLabel(60)).toBe("Good for families"));
  it("0 → Good for families", () => expect(scoreToLabel(0)).toBe("Good for families"));
});

describe("haversineKm", () => {
  it("same point → 0 km", () => {
    expect(haversineKm(35.7022, 139.5795, 35.7022, 139.5795)).toBe(0);
  });

  it("Kichijoji to Shinjuku area is roughly 9-11 km", () => {
    // Kichijoji centroid → Park Hyatt approximate coords
    const dist = haversineKm(35.7022, 139.5795, 35.6896, 139.6917);
    expect(dist).toBeGreaterThan(8);
    expect(dist).toBeLessThan(12);
  });

  it("returns a number with at most one decimal place", () => {
    const dist = haversineKm(35.7022, 139.5795, 35.6895, 139.6917);
    expect(String(dist).replace(/^\d+\.?/, "").length).toBeLessThanOrEqual(1);
  });
});

describe("formatChildrenAges", () => {
  it("no children → empty string", () => expect(formatChildrenAges([])).toBe(""));
  it("one child → 'age N'", () => expect(formatChildrenAges([{ age: 7 }])).toBe("age 7"));
  it("two children → 'ages N & M'", () => expect(formatChildrenAges([{ age: 4 }, { age: 7 }])).toBe("ages 4 & 7"));
  it("three children → 'ages N, M & P'", () =>
    expect(formatChildrenAges([{ age: 4 }, { age: 7 }, { age: 10 }])).toBe("ages 4, 7 & 10"));
});
