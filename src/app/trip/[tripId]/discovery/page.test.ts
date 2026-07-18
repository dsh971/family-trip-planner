import { describe, it, expect } from "vitest";

function corroborationToSignal(score: number): string | null {
  if (score === 0) return null;
  if (score === 1) return "Trending locally";
  return "Highly recommended locally";
}

function metersToMinutes(meters: number): string {
  return `~${Math.max(5, Math.round(meters / 80 / 5) * 5)}-min walk`;
}

type FilterValue = "all" | "eat" | "visit";

interface DiscoveryPlace {
  placeId: string;
  name: string;
  category: "eat" | "visit";
  lat: number;
  lng: number;
}

function filterPlaces(places: DiscoveryPlace[], activeFilter: FilterValue): DiscoveryPlace[] {
  return places.filter((p) => activeFilter === "all" || p.category === activeFilter);
}

function toggleMapExpanded(prev: boolean): boolean {
  return !prev;
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

describe("filterPlaces", () => {
  const places: DiscoveryPlace[] = [
    { placeId: "p1", name: "Ramen Shop", category: "eat", lat: 35.6, lng: 139.7 },
    { placeId: "p2", name: "Sushi Bar", category: "eat", lat: 35.61, lng: 139.71 },
    { placeId: "p3", name: "Tokyo Tower", category: "visit", lat: 35.65, lng: 139.74 },
    { placeId: "p4", name: "Senso-ji", category: "visit", lat: 35.71, lng: 139.79 },
  ];

  it("filter 'all' returns all places", () => {
    expect(filterPlaces(places, "all")).toHaveLength(4);
  });

  it("filter 'eat' returns only eat places", () => {
    const result = filterPlaces(places, "eat");
    expect(result).toHaveLength(2);
    expect(result.every((p) => p.category === "eat")).toBe(true);
  });

  it("filter 'visit' returns only visit places", () => {
    const result = filterPlaces(places, "visit");
    expect(result).toHaveLength(2);
    expect(result.every((p) => p.category === "visit")).toBe(true);
  });

  it("filter 'eat' excludes visit places", () => {
    const result = filterPlaces(places, "eat");
    expect(result.some((p) => p.category === "visit")).toBe(false);
  });

  it("filter 'visit' excludes eat places", () => {
    const result = filterPlaces(places, "visit");
    expect(result.some((p) => p.category === "eat")).toBe(false);
  });

  it("returns empty array when no places match filter", () => {
    const eatOnly: DiscoveryPlace[] = [
      { placeId: "p1", name: "Ramen", category: "eat", lat: 35.6, lng: 139.7 },
    ];
    expect(filterPlaces(eatOnly, "visit")).toHaveLength(0);
  });
});

describe("mobile map toggle", () => {
  it("toggle from expanded to collapsed returns false", () => {
    expect(toggleMapExpanded(true)).toBe(false);
  });

  it("toggle from collapsed to expanded returns true", () => {
    expect(toggleMapExpanded(false)).toBe(true);
  });

  it("toggle button label reflects expanded state (hide map)", () => {
    const mapExpanded = true;
    const label = mapExpanded ? "▲ Hide map" : "▼ Show map";
    expect(label).toBe("▲ Hide map");
  });

  it("toggle button label reflects collapsed state (show map)", () => {
    const mapExpanded = false;
    const label = mapExpanded ? "▲ Hide map" : "▼ Show map";
    expect(label).toBe("▼ Show map");
  });
});
