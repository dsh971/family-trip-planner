import { describe, it, expect } from "vitest";
import {
  filterAndRankCandidates,
  hardExcludeReason,
  rankingScore,
  type DiscoveryCandidate,
  DETOUR_RATING_THRESHOLD,
  DETOUR_REVIEW_COUNT_THRESHOLD,
  isWorthTheDetour,
} from "./filters";
import type { FamilyProfile, SafetyArea } from "@/db/schema";

const baseCandidate: DiscoveryCandidate = {
  placeId: "P1",
  name: "Test Place",
  category: "eat",
  lat: 35.702,
  lng: 139.58,
  rating: 4.2,
  reviewCount: 300,
  priceLevel: 2,
  types: ["restaurant"],
  goodForChildren: null,
  menuForChildren: null,
  sources: ["google-places"],
  corroborationScore: 0,
  distanceFromCentroidMeters: 400,
  worthTheDetour: false,
  photoReference: null,
  description: null,
};

const baseProfile: Pick<FamilyProfile, "dietaryTags" | "accessibilityTags" | "pacingWindows"> = {
  dietaryTags: [],
  accessibilityTags: [],
  pacingWindows: [{ name: "bedtime", startTime: "19:30", endTime: "23:59" }],
};

const emptySafetyAreas: SafetyArea[] = [];

describe("hardExcludeReason", () => {
  it("excludes adult venue types regardless of rating", () => {
    const reason = hardExcludeReason({ types: ["bar"], goodForChildren: null }, baseProfile);
    expect(reason).toBe("adult venue type");
  });

  it("excludes night_club type", () => {
    expect(hardExcludeReason({ types: ["night_club", "restaurant"], goodForChildren: null }, baseProfile)).toBe("adult venue type");
  });

  it("excludes late-night-only venues for a 7:30pm bedtime profile", () => {
    // Venue opens at 10pm — all windows start after bedtime (19:30)
    const hours = [{ startTime: "22:00" }, { startTime: "23:00" }];
    const reason = hardExcludeReason({ types: ["restaurant"], goodForChildren: null }, baseProfile, hours);
    expect(reason).toBe("late-night-only venue");
  });

  it("does NOT exclude a venue open 11am-11pm for a 7:30pm bedtime profile", () => {
    const hours = [{ startTime: "11:00" }, { startTime: "23:00" }];
    const reason = hardExcludeReason({ types: ["restaurant"], goodForChildren: null }, baseProfile, hours);
    expect(reason).toBeNull();
  });

  it("passes a normal restaurant for default profile", () => {
    expect(hardExcludeReason({ types: ["restaurant"], goodForChildren: null }, baseProfile)).toBeNull();
  });
});

describe("rankingScore", () => {
  it("places a corroboration-score-3 candidate above a corroboration-score-0 otherwise-equal candidate", () => {
    const highCorr: DiscoveryCandidate = { ...baseCandidate, corroborationScore: 3 };
    const zeroCorr: DiscoveryCandidate = { ...baseCandidate, corroborationScore: 0 };
    expect(rankingScore(highCorr)).toBeGreaterThan(rankingScore(zeroCorr));
  });

  it("goodForChildren: true boosts rank above absence (neutral) of the same field", () => {
    const withFlag: DiscoveryCandidate = { ...baseCandidate, goodForChildren: true };
    const withoutFlag: DiscoveryCandidate = { ...baseCandidate, goodForChildren: null };
    expect(rankingScore(withFlag)).toBeGreaterThan(rankingScore(withoutFlag));
  });

  it("goodForChildren: null (absent) and goodForChildren: false produce the same score (no penalty for absence)", () => {
    const absent: DiscoveryCandidate = { ...baseCandidate, goodForChildren: null };
    const explicitFalse: DiscoveryCandidate = { ...baseCandidate, goodForChildren: false };
    expect(rankingScore(absent)).toBe(rankingScore(explicitFalse));
  });

  it("priceLevel 4 is ranked below priceLevel 2 otherwise-equal venue", () => {
    const expensive: DiscoveryCandidate = { ...baseCandidate, priceLevel: 4 };
    const moderate: DiscoveryCandidate = { ...baseCandidate, priceLevel: 2 };
    expect(rankingScore(expensive)).toBeLessThan(rankingScore(moderate));
  });

  it("priceLevel 4 is not excluded — it still appears in results", () => {
    const expensive: DiscoveryCandidate = { ...baseCandidate, priceLevel: 4 };
    const results = filterAndRankCandidates([expensive], baseProfile, emptySafetyAreas);
    expect(results).toHaveLength(1);
  });
});

describe("filterAndRankCandidates — happy path and edge cases", () => {
  it("returns places annotated with distance and corroboration score", () => {
    const results = filterAndRankCandidates(
      [{ ...baseCandidate, corroborationScore: 2 }],
      baseProfile,
      emptySafetyAreas
    );
    expect(results[0]!.corroborationScore).toBe(2);
    expect(results[0]!.distanceFromCentroidMeters).toBe(400);
  });

  it("a web-search-only place (corroborationScore 0) ranks below a corroborated place", () => {
    const noCorr: DiscoveryCandidate = { ...baseCandidate, placeId: "A", corroborationScore: 0 };
    const highCorr: DiscoveryCandidate = { ...baseCandidate, placeId: "B", corroborationScore: 3 };
    const results = filterAndRankCandidates([noCorr, highCorr], baseProfile, emptySafetyAreas);
    expect(results[0]!.placeId).toBe("B");
    expect(results[1]!.placeId).toBe("A");
  });

  it("excludes a restaurant incompatible with dietary tag (accessibility tag check)", () => {
    const profileWithAccessibility: typeof baseProfile = {
      ...baseProfile,
      accessibilityTags: ["wheelchair"],
    };
    const lodging: DiscoveryCandidate = { ...baseCandidate, types: ["lodging"] };
    const results = filterAndRankCandidates([lodging], profileWithAccessibility, emptySafetyAreas);
    expect(results).toHaveLength(0);
  });

  it("excludes bar venue regardless of rating or corroboration score", () => {
    const bar: DiscoveryCandidate = { ...baseCandidate, types: ["bar"], rating: 5.0, corroborationScore: 5 };
    const results = filterAndRankCandidates([bar], baseProfile, emptySafetyAreas);
    expect(results).toHaveLength(0);
  });

  it("places near a SafetyArea appear in results but ranked below otherwise-equal safe places (R13)", () => {
    const safeCandidateA: DiscoveryCandidate = { ...baseCandidate, placeId: "SAFE", lat: 35.0, lng: 138.0, corroborationScore: 0 };
    // Place this candidate very close to the safety area point
    const nearFlagged: DiscoveryCandidate = { ...baseCandidate, placeId: "NEAR", lat: 35.5002, lng: 139.5, corroborationScore: 0 };

    const sa: SafetyArea = {
      id: 1,
      destinationId: 1,
      name: "Test Area",
      geometry: { type: "point", lat: 35.5, lng: 139.5 },
      riskType: "theft",
      sourceQuote: "Test",
    };

    const results = filterAndRankCandidates([safeCandidateA, nearFlagged], baseProfile, [sa]);
    expect(results).toHaveLength(2);
    // Safe place should rank higher
    expect(results[0]!.placeId).toBe("SAFE");
    expect(results[1]!.placeId).toBe("NEAR");
  });

  it("late-night-only venue (all opening times after bedtime) is excluded", () => {
    const lateVenue: DiscoveryCandidate = { ...baseCandidate, placeId: "LATE" };
    const hoursMap = new Map([["LATE", [{ startTime: "22:00" }]]]);
    const results = filterAndRankCandidates([lateVenue], baseProfile, emptySafetyAreas, hoursMap);
    expect(results).toHaveLength(0);
  });

  it("venue open 11am-11pm is NOT excluded for 7:30pm bedtime profile", () => {
    const venue: DiscoveryCandidate = { ...baseCandidate, placeId: "DAYTIME" };
    const hoursMap = new Map([["DAYTIME", [{ startTime: "11:00" }, { startTime: "23:00" }]]]);
    const results = filterAndRankCandidates([venue], baseProfile, emptySafetyAreas, hoursMap);
    expect(results).toHaveLength(1);
  });
});

describe("isWorthTheDetour (KTD-E thresholds)", () => {
  it("flags an out-of-radius item that meets rating+review threshold", () => {
    const candidate: DiscoveryCandidate = {
      ...baseCandidate,
      rating: DETOUR_RATING_THRESHOLD,
      reviewCount: DETOUR_REVIEW_COUNT_THRESHOLD,
    };
    expect(isWorthTheDetour(candidate)).toBe(true);
  });

  it("flags an item with 3+ WG corroboration sources as trending (worth the detour)", () => {
    const candidate: DiscoveryCandidate = { ...baseCandidate, corroborationScore: 3 };
    expect(isWorthTheDetour(candidate)).toBe(true);
  });

  it("does not flag a below-threshold item", () => {
    const candidate: DiscoveryCandidate = {
      ...baseCandidate,
      rating: 4.0,
      reviewCount: 100,
      corroborationScore: 0,
    };
    expect(isWorthTheDetour(candidate)).toBe(false);
  });
});
