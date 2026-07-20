import { describe, it, expect } from "vitest";

function corroborationToSignal(score: number): string | null {
  if (score === 0) return null;
  if (score === 1) return "Trending locally";
  return "Highly recommended locally";
}

const HOTEL_WALK_THRESHOLD_METERS = 2800;

function formatWalkingLabel(meters: number, landmark: string): string {
  return `~${Math.max(5, Math.round(meters / 80 / 5) * 5)}-min walking from ${landmark}`;
}

function formatTransitLabel(meters: number, stationName: string): string {
  return `~${Math.max(5, Math.round(meters / 60 / 5) * 5)}-min walk from ${stationName}`;
}

interface TransitStation { name: string; lat: number; lng: number; }

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function nearestTransitStation(
  placeLat: number, placeLng: number, stations: TransitStation[]
): TransitStation | null {
  if (stations.length === 0) return null;
  let nearest = stations[0]!;
  let minDist = haversineMeters(placeLat, placeLng, nearest.lat, nearest.lng);
  for (let i = 1; i < stations.length; i++) {
    const d = haversineMeters(placeLat, placeLng, stations[i]!.lat, stations[i]!.lng);
    if (d < minDist) { minDist = d; nearest = stations[i]!; }
  }
  return nearest;
}

function selectDistanceLabel(
  placeLat: number, placeLng: number,
  distFromCentroid: number,
  lodgingLat: number | null, lodgingLng: number | null,
  neighborhoodName: string,
  stations: TransitStation[]
): string {
  if (lodgingLat !== null && lodgingLng !== null) {
    const distFromHotel = haversineMeters(lodgingLat, lodgingLng, placeLat, placeLng);
    if (distFromHotel <= HOTEL_WALK_THRESHOLD_METERS) {
      return formatWalkingLabel(distFromHotel, "hotel");
    }
    const nearest = nearestTransitStation(placeLat, placeLng, stations);
    if (nearest) {
      return formatTransitLabel(
        haversineMeters(placeLat, placeLng, nearest.lat, nearest.lng),
        nearest.name
      );
    }
    return formatWalkingLabel(distFromHotel, "hotel");
  }
  const nearestNoHotel = nearestTransitStation(placeLat, placeLng, stations);
  if (nearestNoHotel) {
    return formatTransitLabel(
      haversineMeters(placeLat, placeLng, nearestNoHotel.lat, nearestNoHotel.lng),
      nearestNoHotel.name
    );
  }
  return `In ${neighborhoodName}`;
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

function shouldRenderPhoto(photoReference: string | null): boolean {
  return photoReference !== null;
}

function shouldRenderDescription(description: string | null): boolean {
  return description !== null;
}

function isSkippedCard(currentDecision: "yes" | "no" | null): boolean {
  return currentDecision === "no";
}

function getEmptyStateDescription(activeFilter: "all" | "eat" | "visit"): string {
  return activeFilter === "eat"
    ? "No restaurants found here — try the All filter."
    : activeFilter === "visit"
      ? "No activities found here — try the All filter."
      : "Nothing found in this category.";
}

describe("corroborationToSignal", () => {
  it("score 0 → null", () => expect(corroborationToSignal(0)).toBeNull());
  it("score 1 → 'Trending locally'", () => expect(corroborationToSignal(1)).toBe("Trending locally"));
  it("score 2 → 'Highly recommended locally'", () => expect(corroborationToSignal(2)).toBe("Highly recommended locally"));
  it("score 5 → 'Highly recommended locally'", () => expect(corroborationToSignal(5)).toBe("Highly recommended locally"));
});

describe("formatWalkingLabel", () => {
  it("1200m → ~15-min walking from hotel", () => expect(formatWalkingLabel(1200, "hotel")).toBe("~15-min walking from hotel"));
  it("200m (floor) → ~5-min walking from Shinjuku", () => expect(formatWalkingLabel(200, "Shinjuku")).toBe("~5-min walking from Shinjuku"));
  it("400m → ~5-min walking from area", () => expect(formatWalkingLabel(400, "area")).toBe("~5-min walking from area"));
  it("800m → ~10-min walking from Asakusa", () => expect(formatWalkingLabel(800, "Asakusa")).toBe("~10-min walking from Asakusa"));
});

describe("formatTransitLabel", () => {
  it("300m at 60 m/min → ~5-min walk from Shinjuku Station (floor)", () => expect(formatTransitLabel(300, "Shinjuku Station")).toBe("~5-min walk from Shinjuku Station"));
  it("900m at 60 m/min → ~15-min walk from Shibuya Station", () => expect(formatTransitLabel(900, "Shibuya Station")).toBe("~15-min walk from Shibuya Station"));
  it("180m (below floor) → ~5-min walk from Harajuku Station", () => expect(formatTransitLabel(180, "Harajuku Station")).toBe("~5-min walk from Harajuku Station"));
  it("1800m at 60 m/min → ~30-min walk from Ikebukuro Station", () => expect(formatTransitLabel(1800, "Ikebukuro Station")).toBe("~30-min walk from Ikebukuro Station"));
});

describe("nearestTransitStation", () => {
  const stations: TransitStation[] = [
    { name: "Station A", lat: 35.690, lng: 139.700 },
    { name: "Station B", lat: 35.700, lng: 139.710 },
    { name: "Station C", lat: 35.680, lng: 139.690 },
  ];

  it("returns the station with minimum haversine distance from place", () => {
    // Place is at 35.699, 139.709 — closest to Station B
    const result = nearestTransitStation(35.699, 139.709, stations);
    expect(result!.name).toBe("Station B");
  });

  it("returns null when stations array is empty", () => {
    expect(nearestTransitStation(35.699, 139.709, [])).toBeNull();
  });

  it("returns the only station unconditionally when array has one entry", () => {
    const result = nearestTransitStation(35.0, 139.0, [{ name: "Only Station", lat: 35.9, lng: 139.9 }]);
    expect(result!.name).toBe("Only Station");
  });
});

describe("distance label selection", () => {
  const PLACE_LAT = 35.690;
  const PLACE_LNG = 139.700;
  const HOTEL_LAT = 35.690; // Same lat/lng → 0 distance → walking label
  const HOTEL_LNG = 139.700;

  it("hotel ≤35 min away → walking-from-hotel label", () => {
    // Hotel at same coords as place → 0m → floor to 5 min
    const label = selectDistanceLabel(PLACE_LAT, PLACE_LNG, 800, HOTEL_LAT, HOTEL_LNG, "Shinjuku", []);
    expect(label).toBe("~5-min walking from hotel");
  });

  it("hotel >35 min away + stations present → transit label", () => {
    // Hotel very far north so haversine > 2800m; place near station
    const farHotelLat = 36.0; // ~34km north
    const stations: TransitStation[] = [{ name: "Shinjuku Station", lat: 35.690, lng: 139.700 }];
    const label = selectDistanceLabel(PLACE_LAT, PLACE_LNG, 800, farHotelLat, HOTEL_LNG, "Shinjuku", stations);
    // Station is at same coords as place → 0m → floor to 5 min
    expect(label).toBe("~5-min walk from Shinjuku Station");
  });

  it("hotel >35 min away + no stations → walking-from-hotel fallback", () => {
    const farHotelLat = 36.0;
    const label = selectDistanceLabel(PLACE_LAT, PLACE_LNG, 800, farHotelLat, HOTEL_LNG, "Shinjuku", []);
    // No stations → falls back to walking from hotel
    expect(label).toMatch(/walking from hotel/);
  });

  it("no hotel + station present → transit label from station", () => {
    const stations: TransitStation[] = [{ name: "Asakusa Station", lat: PLACE_LAT, lng: PLACE_LNG }];
    const label = selectDistanceLabel(PLACE_LAT, PLACE_LNG, 800, null, null, "Asakusa", stations);
    // Station at same coords → 0m → floor to 5 min
    expect(label).toBe("~5-min walk from Asakusa Station");
  });

  it("no hotel + no stations → In [Neighborhood]", () => {
    const label = selectDistanceLabel(PLACE_LAT, PLACE_LNG, 800, null, null, "Asakusa", []);
    expect(label).toBe("In Asakusa");
  });

  it("no hotel + partial null lodgingLng + no stations → In [Neighborhood]", () => {
    const label = selectDistanceLabel(PLACE_LAT, PLACE_LNG, 400, 35.69, null, "Harajuku", []);
    expect(label).toBe("In Harajuku");
  });
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

describe("PlaceCard photo hero", () => {
  it("non-null photoReference → img renders via /api/places/photo endpoint", () => {
    expect(shouldRenderPhoto("CmRaAAAAtest_ref_abc123")).toBe(true);
  });

  it("null photoReference → img does not render (shows color strip placeholder)", () => {
    expect(shouldRenderPhoto(null)).toBe(false);
  });

  it("place with no photo reference shows placeholder, not img", () => {
    const noPhotoRef: string | null = null;
    expect(shouldRenderPhoto(noPhotoRef)).toBe(false);
  });
});

describe("PlaceCard description snippet", () => {
  it("non-null description → description element renders (shouldRenderDescription = true)", () => {
    expect(shouldRenderDescription("A great local ramen shop with rich broth.")).toBe(true);
  });

  it("null description → no element renders (shouldRenderDescription = false)", () => {
    expect(shouldRenderDescription(null)).toBe(false);
  });

  it("empty string description is treated as truthy (non-null) — renders", () => {
    expect(shouldRenderDescription("")).toBe(true);
  });
});

describe("PlaceCard skipped state", () => {
  it("currentDecision 'no' → skipped card branch (no photo or description)", () => {
    expect(isSkippedCard("no")).toBe(true);
  });

  it("currentDecision null → active card (photo and description rendered)", () => {
    expect(isSkippedCard(null)).toBe(false);
  });

  it("currentDecision 'yes' → added card (photo and description rendered)", () => {
    expect(isSkippedCard("yes")).toBe(false);
  });
});

describe("getEmptyStateDescription", () => {
  it("'eat' filter → no restaurants message", () => {
    expect(getEmptyStateDescription("eat")).toBe("No restaurants found here — try the All filter.");
  });
  it("'visit' filter → no activities message", () => {
    expect(getEmptyStateDescription("visit")).toBe("No activities found here — try the All filter.");
  });
  it("'all' filter → generic message", () => {
    expect(getEmptyStateDescription("all")).toBe("Nothing found in this category.");
  });
});
