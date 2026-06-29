import type { Neighborhood, SafetyArea } from "@/db/schema";

export interface RankedNeighborhood extends Neighborhood {
  rankingScore: number;
  safetyPenalty: number;
}

// Penalty applied when a neighborhood centroid is within its own walking radius of a SafetyArea point.
const SAFETY_PENALTY = 15;

function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
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

function isSafetyAreaNear(
  neighborhood: Neighborhood,
  safetyAreas: SafetyArea[]
): boolean {
  return safetyAreas.some((sa) => {
    const geo = sa.geometry as
      | { type: "point"; lat: number; lng: number }
      | { type: "polygon"; coordinates: Array<[number, number]> };

    if (geo.type === "point") {
      const dist = haversineMeters(
        neighborhood.centroidLat,
        neighborhood.centroidLng,
        geo.lat,
        geo.lng
      );
      return dist <= neighborhood.walkingRadiusMeters;
    }

    // Polygon: check if centroid is within the polygon's bounding box as an approximation
    if (geo.type === "polygon" && geo.coordinates.length > 0) {
      const lats = geo.coordinates.map(([lat]) => lat);
      const lngs = geo.coordinates.map(([, lng]) => lng);
      const minLat = Math.min(...lats);
      const maxLat = Math.max(...lats);
      const minLng = Math.min(...lngs);
      const maxLng = Math.max(...lngs);
      return (
        neighborhood.centroidLat >= minLat &&
        neighborhood.centroidLat <= maxLat &&
        neighborhood.centroidLng >= minLng &&
        neighborhood.centroidLng <= maxLng
      );
    }

    return false;
  });
}

// Ranks neighborhoods by family-friendliness with safety-aware deprioritization (R1, R13).
// Returns top 3-5 neighborhoods sorted by rankingScore descending.
export function rankNeighborhoods(
  neighborhoods: Neighborhood[],
  safetyAreas: SafetyArea[],
  topN = 5
): RankedNeighborhood[] {
  const ranked = neighborhoods.map((nb): RankedNeighborhood => {
    const near = isSafetyAreaNear(nb, safetyAreas);
    const safetyPenalty = near ? SAFETY_PENALTY : 0;
    return {
      ...nb,
      safetyPenalty,
      rankingScore: nb.familyFriendlinessScore - safetyPenalty,
    };
  });

  ranked.sort((a, b) => b.rankingScore - a.rankingScore);
  return ranked.slice(0, topN);
}
