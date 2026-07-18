// Discovery pipeline filters and ranking (KTD-C, R4, R5, R13).

import type { FamilyProfile, SafetyArea, Neighborhood } from "@/db/schema";

// Adult venue types hard-excluded regardless of rating (KTD-C Stage 4)
const ADULT_VENUE_TYPES = ["bar", "night_club", "casino", "liquor_store"] as const;

export interface DiscoveryCandidate {
  placeId: string;
  name: string;
  category: "eat" | "visit";
  lat: number;
  lng: number;
  rating: number | null;
  reviewCount: number | null;
  priceLevel: number | null;
  types: string[];
  goodForChildren: boolean | null;
  menuForChildren: boolean | null;
  sources: string[];
  corroborationScore: number;
  distanceFromCentroidMeters: number;
  worthTheDetour: boolean;
  photoReference: string | null;
  description: string | null;
  // Populated by safety check
  nearSafetyArea?: boolean;
}

export interface FilteredResult extends DiscoveryCandidate {
  rankPosition: number;
}

function parseTime(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function isAdultVenue(types: string[]): boolean {
  return types.some((t) => (ADULT_VENUE_TYPES as readonly string[]).includes(t));
}

function isLateNightOnly(openingHours: Array<{ startTime: string }>, bedtimeStart: string): boolean {
  if (openingHours.length === 0) return false;
  const bedtime = parseTime(bedtimeStart);
  return openingHours.every((h) => parseTime(h.startTime) >= bedtime);
}

function isDietaryCompatible(types: string[], dietaryTags: string[]): boolean {
  if (dietaryTags.length === 0) return true;
  for (const tag of dietaryTags) {
    const normalized = tag.toLowerCase();
    if (normalized === "vegetarian" && types.some((t) => t.toLowerCase().includes("vegan") || t.toLowerCase().includes("vegetarian"))) {
      continue;
    }
    // Conservative: only hard-exclude when venue type is explicitly incompatible.
    // Missing data is not a reason to exclude.
  }
  return true;
}

function isAccessibilityCompatible(types: string[], accessibilityTags: string[]): boolean {
  if (accessibilityTags.length === 0) return true;
  for (const tag of accessibilityTags) {
    const normalized = tag.toLowerCase();
    if ((normalized === "wheelchair" || normalized === "stroller") && types.includes("lodging")) {
      return false;
    }
  }
  return true;
}

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

function isNearSafetyArea(
  lat: number,
  lng: number,
  safetyAreas: SafetyArea[]
): boolean {
  return safetyAreas.some((sa) => {
    const geo = sa.geometry as
      | { type: "point"; lat: number; lng: number }
      | { type: "polygon"; coordinates: Array<[number, number]> };
    if (geo.type === "point") {
      return haversineMeters(lat, lng, geo.lat, geo.lng) < 500;
    }
    return false;
  });
}

// "Worth the detour" thresholds (KTD-E) — stored as destination-tunable constants
export const DETOUR_RATING_THRESHOLD = 4.5;
export const DETOUR_REVIEW_COUNT_THRESHOLD = 500;

export function isWorthTheDetour(candidate: DiscoveryCandidate): boolean {
  const ratingOk = (candidate.rating ?? 0) >= DETOUR_RATING_THRESHOLD;
  const reviewsOk = (candidate.reviewCount ?? 0) >= DETOUR_REVIEW_COUNT_THRESHOLD;
  const wgTrending = candidate.corroborationScore >= 3; // 3+ independent sources = trending
  return (ratingOk && reviewsOk) || wgTrending;
}

// Hard-exclude an eat/visit candidate based on family profile (R4).
// Returns the reason for exclusion or null if the candidate passes.
export function hardExcludeReason(
  candidate: Pick<DiscoveryCandidate, "types" | "goodForChildren">,
  profile: Pick<FamilyProfile, "dietaryTags" | "accessibilityTags" | "pacingWindows">,
  openingHours: Array<{ startTime: string }> = []
): string | null {
  if (isAdultVenue(candidate.types)) {
    return "adult venue type";
  }

  const pacingWindows = profile.pacingWindows as Array<{ name: string; startTime: string; endTime: string }>;
  const bedtime = pacingWindows.find((w) => w.name === "bedtime");
  if (bedtime && isLateNightOnly(openingHours, bedtime.startTime)) {
    return "late-night-only venue";
  }

  const dietaryTags = profile.dietaryTags as string[];
  if (!isDietaryCompatible(candidate.types, dietaryTags)) {
    return "dietary incompatibility";
  }

  const accessibilityTags = profile.accessibilityTags as string[];
  if (!isAccessibilityCompatible(candidate.types, accessibilityTags)) {
    return "accessibility incompatibility";
  }

  return null;
}

// Compute a ranking score for a discovery candidate.
// Higher = better. (KTD-C ranking signals in descending priority)
export function rankingScore(candidate: DiscoveryCandidate): number {
  let score = 0;

  // 1. Corroboration score (primary — cross-source trust)
  score += candidate.corroborationScore * 20;

  // 2. Google Places rating (0-5 scale, weight 15)
  score += (candidate.rating ?? 0) * 15;

  // 3. goodForChildren / menuForChildren boost (+5 each)
  if (candidate.goodForChildren === true) score += 5;
  if (candidate.menuForChildren === true) score += 5;

  // 4. Price level — soft deprioritization (priceLevel 4 = -8, 3 = -4, lower = no penalty)
  if (candidate.priceLevel === 4) score -= 8;
  else if (candidate.priceLevel === 3) score -= 4;

  // 5. Distance tiebreaker — closer = better (max 10 points)
  const distanceScore = Math.max(0, 10 - candidate.distanceFromCentroidMeters / 200);
  score += distanceScore;

  // Safety deprioritization: near-SafetyArea places rank lower
  if (candidate.nearSafetyArea) score -= 20;

  return score;
}

// Apply family-fit filtering and ranking to a list of discovery candidates.
// Returns filtered results in rank order with unscheduled fallback handling.
export function filterAndRankCandidates(
  candidates: DiscoveryCandidate[],
  profile: Pick<FamilyProfile, "dietaryTags" | "accessibilityTags" | "pacingWindows">,
  safetyAreas: SafetyArea[],
  openingHoursMap: Map<string, Array<{ startTime: string }>> = new Map()
): FilteredResult[] {
  const survivors: DiscoveryCandidate[] = [];

  for (const candidate of candidates) {
    // Annotate safety proximity
    const nearSafetyArea = isNearSafetyArea(candidate.lat, candidate.lng, safetyAreas);
    const annotated: DiscoveryCandidate = { ...candidate, nearSafetyArea };

    const hours = openingHoursMap.get(candidate.placeId) ?? [];
    const reason = hardExcludeReason(annotated, profile, hours);
    if (reason) continue;

    survivors.push(annotated);
  }

  // Sort by ranking score descending
  survivors.sort((a, b) => rankingScore(b) - rankingScore(a));

  return survivors.map((c, i) => ({ ...c, rankPosition: i + 1 }));
}

// Compute walking distance from neighborhood centroid for each candidate
export function annotateDistances(
  candidates: Omit<DiscoveryCandidate, "distanceFromCentroidMeters">[],
  neighborhood: Pick<Neighborhood, "centroidLat" | "centroidLng">
): DiscoveryCandidate[] {
  return candidates.map((c) => ({
    ...c,
    distanceFromCentroidMeters: haversineMeters(
      neighborhood.centroidLat,
      neighborhood.centroidLng,
      c.lat,
      c.lng
    ),
    worthTheDetour: false, // computed later after distance is known
  }));
}
