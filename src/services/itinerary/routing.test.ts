import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  routePassesThroughSafetyArea,
  computeRoute,
  computeDayRoutes,
  type RouteRequest,
} from "./routing";
import { WGUnavailableError } from "@/services/wanderlust-goat/types";
import type { SafetyArea } from "@/db/schema";

vi.mock("@/services/wanderlust-goat/client", () => ({
  routeView: vi.fn(),
}));

import { routeView } from "@/services/wanderlust-goat/client";
const routeViewMock = vi.mocked(routeView);

const mockAnchor = (q: string) => ({
  query: q, lat: 35.68, lng: 139.69, country: "JP", display: q, city: "Tokyo",
});

const baseRoute: RouteRequest = {
  fromName: "Kichijoji Station, Tokyo, Japan",
  toName: "Inokashira Park, Tokyo, Japan",
  fromLat: 35.702,
  fromLng: 139.580,
  toLat: 35.699,
  toLng: 139.576,
};

const noSafetyAreas: SafetyArea[] = [];

const roppongiSafetyArea: SafetyArea = {
  id: 1,
  destinationId: 1,
  name: "Roppongi",
  geometry: { type: "point", lat: 35.662, lng: 139.731 },
  riskType: "assault",
  sourceQuote: "OSAC advisory",
};

describe("routePassesThroughSafetyArea", () => {
  it("returns passes: false when no safety areas exist", () => {
    const result = routePassesThroughSafetyArea(35.702, 139.58, 35.699, 139.576, []);
    expect(result.passes).toBe(false);
    expect(result.areaName).toBeNull();
  });

  it("returns passes: false when route is far from all safety areas", () => {
    // Route in Kichijoji (NW Tokyo), Roppongi safety area is in central Tokyo
    const result = routePassesThroughSafetyArea(35.702, 139.58, 35.699, 139.576, [roppongiSafetyArea]);
    expect(result.passes).toBe(false);
  });

  it("returns passes: true when route passes within 400m of a safety area point", () => {
    // Route along 35.662 lat — endpoint very near Roppongi safety point
    const result = routePassesThroughSafetyArea(
      35.662, 139.720, // near Roppongi
      35.662, 139.750, // passes through corridor
      [roppongiSafetyArea]
    );
    expect(result.passes).toBe(true);
    expect(result.areaName).toBe("Roppongi");
  });

  it("uses line-to-point distance not just endpoint distance", () => {
    // Route: start/end both far, but midpoint passes near safety area
    // Safety point at (35.662, 139.731), route goes (35.662, 139.720) → (35.662, 139.740)
    // Closest point on segment to safety area: t ≈ 0.55, at (35.662, 139.731), dist ≈ 0m
    const result = routePassesThroughSafetyArea(
      35.662, 139.720,
      35.662, 139.740,
      [roppongiSafetyArea]
    );
    expect(result.passes).toBe(true);
  });
});

describe("computeRoute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns route data with safety flag when WG succeeds", async () => {
    routeViewMock.mockResolvedValueOnce({
      from: mockAnchor(baseRoute.fromName),
      to: mockAnchor(baseRoute.toName),
      buffer_meters: 200,
      distance_meters: 500,
      walking_minutes: 7,
      along_route: null,
      note: "short walk",
    });

    const result = await computeRoute(baseRoute, noSafetyAreas);
    expect(result.distanceMeters).toBe(500);
    expect(result.walkingMinutes).toBe(7);
    expect(result.safetyConcern).toBe(false);
    expect(result.wgAvailable).toBe(true);
  });

  it("flags safetyConcern when route corridor crosses a safety area", async () => {
    routeViewMock.mockResolvedValueOnce({
      from: mockAnchor("A"),
      to: mockAnchor("B"),
      buffer_meters: 200,
      distance_meters: 2000,
      walking_minutes: 25,
      along_route: null,
      note: "route ok",
    });

    const dangerRoute: RouteRequest = {
      ...baseRoute,
      fromLat: 35.662, fromLng: 139.720,
      toLat: 35.662, toLng: 139.740,
    };
    const result = await computeRoute(dangerRoute, [roppongiSafetyArea]);
    expect(result.safetyConcern).toBe(true);
    expect(result.safetyConcernName).toBe("Roppongi");
  });

  it("gracefully degrades when WG unavailable — still returns safety flag", async () => {
    routeViewMock.mockRejectedValueOnce(new WGUnavailableError());

    const dangerRoute: RouteRequest = {
      ...baseRoute,
      fromLat: 35.662, fromLng: 139.720,
      toLat: 35.662, toLng: 139.740,
    };
    const result = await computeRoute(dangerRoute, [roppongiSafetyArea]);
    expect(result.wgAvailable).toBe(false);
    expect(result.walkingMinutes).toBeNull();
    // Safety flag still computed from geometry even without WG
    expect(result.safetyConcern).toBe(true);
  });

  it("rethrows non-WG errors", async () => {
    routeViewMock.mockRejectedValueOnce(new Error("timeout"));
    await expect(computeRoute(baseRoute, noSafetyAreas)).rejects.toThrow("timeout");
  });
});

describe("computeDayRoutes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns N-1 routes for N scheduled places", async () => {
    routeViewMock.mockResolvedValue({
      from: mockAnchor("A"),
      to: mockAnchor("B"),
      buffer_meters: 200,
      distance_meters: 400,
      walking_minutes: 5,
      along_route: null,
      note: "ok",
    });

    const segments = [
      { placeId: 1, placeName: "Place A", lat: 35.702, lng: 139.58, segmentType: "place" },
      { placeId: 2, placeName: "Place B", lat: 35.700, lng: 139.576, segmentType: "place" },
      { placeId: 3, placeName: "Place C", lat: 35.699, lng: 139.570, segmentType: "place" },
    ];

    const routes = await computeDayRoutes(segments, noSafetyAreas);
    expect(routes).toHaveLength(2); // 3 places → 2 legs
    expect(routeViewMock).toHaveBeenCalledTimes(2);
  });

  it("skips pacing-block segments when computing routes", async () => {
    routeViewMock.mockResolvedValue({
      from: mockAnchor("A"),
      to: mockAnchor("B"),
      buffer_meters: 200,
      distance_meters: 400,
      walking_minutes: 5,
      along_route: null,
      note: "ok",
    });

    const segments = [
      { placeId: 1, placeName: "Place A", lat: 35.702, lng: 139.58, segmentType: "place" },
      { placeId: null, placeName: null, lat: null, lng: null, segmentType: "pacing-block" },
      { placeId: 2, placeName: "Place B", lat: 35.700, lng: 139.576, segmentType: "place" },
    ];

    const routes = await computeDayRoutes(segments, noSafetyAreas);
    expect(routes).toHaveLength(1); // pacing-block is skipped
  });

  it("returns empty array when fewer than 2 place segments", async () => {
    const segments = [
      { placeId: 1, placeName: "Only One", lat: 35.702, lng: 139.58, segmentType: "place" },
    ];
    const routes = await computeDayRoutes(segments, noSafetyAreas);
    expect(routes).toHaveLength(0);
    expect(routeViewMock).not.toHaveBeenCalled();
  });
});
