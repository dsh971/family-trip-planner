// Commute routing and safety flagging for itinerary segments (U9, KTD-I, R14).
// Uses WG route-view to compute transit time between adjacent scheduled places.
// Flags routes that pass within 400m of a SafetyArea centroid.

import { routeView } from "@/services/wanderlust-goat/client";
import { WGUnavailableError } from "@/services/wanderlust-goat/types";
import type { SafetyArea } from "@/db/schema";

export interface RouteRequest {
  fromName: string;
  toName: string;
  fromLat: number;
  fromLng: number;
  toLat: number;
  toLng: number;
}

export interface RouteResult {
  fromName: string;
  toName: string;
  distanceMeters: number | null;
  walkingMinutes: number | null;
  safetyConcern: boolean;
  safetyConcernName: string | null;
  wgAvailable: boolean;
  note: string | null;
}

export interface RouteSegment {
  order: string; // fractional order string placed BETWEEN the two place segments
  segmentType: "route";
  payload: RouteResult;
}

const SAFETY_CORRIDOR_METERS = 400;

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Approximate: does the straight-line path between from/to pass within
// SAFETY_CORRIDOR_METERS of any SafetyArea point?
// Uses the line-to-point distance formula as a conservative estimate.
export function routePassesThroughSafetyArea(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
  safetyAreas: SafetyArea[]
): { passes: boolean; areaName: string | null } {
  for (const sa of safetyAreas) {
    const geo = sa.geometry as
      | { type: "point"; lat: number; lng: number }
      | { type: "polygon"; coordinates: Array<[number, number]> };

    if (geo.type !== "point") continue;

    // Line-to-point distance: parametric t ∈ [0,1], closest point on segment
    const dx = toLat - fromLat;
    const dy = toLng - fromLng;
    const lenSq = dx * dx + dy * dy;
    let t = 0;
    if (lenSq > 0) {
      t = Math.max(0, Math.min(1, ((geo.lat - fromLat) * dx + (geo.lng - fromLng) * dy) / lenSq));
    }
    const closestLat = fromLat + t * dx;
    const closestLng = fromLng + t * dy;
    const dist = haversineMeters(closestLat, closestLng, geo.lat, geo.lng);

    if (dist < SAFETY_CORRIDOR_METERS) {
      return { passes: true, areaName: sa.name };
    }
  }

  return { passes: false, areaName: null };
}

// Compute transit route for a single leg. Gracefully degrades when WG is unavailable.
export async function computeRoute(
  req: RouteRequest,
  safetyAreas: SafetyArea[]
): Promise<RouteResult> {
  const { passes, areaName } = routePassesThroughSafetyArea(
    req.fromLat, req.fromLng,
    req.toLat, req.toLng,
    safetyAreas
  );

  try {
    const wgResult = await routeView(req.fromName, req.toName);

    return {
      fromName: req.fromName,
      toName: req.toName,
      distanceMeters: wgResult.distance_meters,
      walkingMinutes: wgResult.walking_minutes,
      safetyConcern: passes,
      safetyConcernName: areaName,
      wgAvailable: true,
      note: wgResult.note,
    };
  } catch (err) {
    if (err instanceof WGUnavailableError) {
      return {
        fromName: req.fromName,
        toName: req.toName,
        distanceMeters: null,
        walkingMinutes: null,
        safetyConcern: passes,
        safetyConcernName: areaName,
        wgAvailable: false,
        note: "Routing unavailable",
      };
    }
    throw err;
  }
}

// Compute routes between all adjacent scheduled place segments in a day.
// Returns RouteResult list in segment order (one per transition).
export async function computeDayRoutes(
  segments: Array<{
    placeId: number | null;
    placeName: string | null;
    lat: number | null;
    lng: number | null;
    segmentType: string;
  }>,
  safetyAreas: SafetyArea[]
): Promise<RouteResult[]> {
  const placeSegments = segments.filter(
    (s) => s.segmentType === "place" && s.placeId !== null && s.lat !== null && s.lng !== null
  );

  const routes: RouteResult[] = [];
  for (let i = 0; i < placeSegments.length - 1; i++) {
    const from = placeSegments[i]!;
    const to = placeSegments[i + 1]!;

    const route = await computeRoute(
      {
        fromName: from.placeName ?? "Tokyo, Japan",
        toName: to.placeName ?? "Tokyo, Japan",
        fromLat: from.lat!,
        fromLng: from.lng!,
        toLat: to.lat!,
        toLng: to.lng!,
      },
      safetyAreas
    );
    routes.push(route);
  }

  return routes;
}
