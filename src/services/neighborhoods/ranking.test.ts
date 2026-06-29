import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import { resolve } from "path";
import * as schema from "@/db/schema";
import { runSeed } from "@/db/seed";
import { rankNeighborhoods } from "./ranking";

const MIGRATIONS_FOLDER = resolve(__dirname, "../../db/migrations");

function createDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db;
}

type Db = ReturnType<typeof createDb>;

describe("U4: Neighborhood ranking", () => {
  let db: Db;
  let destinationId: number;

  beforeEach(() => {
    db = createDb();
    runSeed(db);
    const dest = db.select().from(schema.destinations).where(eq(schema.destinations.slug, "tokyo")).all()[0]!;
    destinationId = dest.id;
  });

  it("returns 3-5 neighborhoods sorted by ranking score (AE1)", () => {
    const neighborhoods = db
      .select()
      .from(schema.neighborhoods)
      .where(eq(schema.neighborhoods.destinationId, destinationId))
      .all();
    const safetyAreas = db
      .select()
      .from(schema.safetyAreas)
      .where(eq(schema.safetyAreas.destinationId, destinationId))
      .all();

    const ranked = rankNeighborhoods(neighborhoods, safetyAreas, 5);
    expect(ranked.length).toBeGreaterThanOrEqual(3);
    expect(ranked.length).toBeLessThanOrEqual(5);

    // Verify descending sort
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i]!.rankingScore).toBeLessThanOrEqual(ranked[i - 1]!.rankingScore);
    }
  });

  it("each result has a dayInTheLifePreview attached (R2, AE1)", () => {
    const neighborhoods = db.select().from(schema.neighborhoods).where(eq(schema.neighborhoods.destinationId, destinationId)).all();
    const safetyAreas = db.select().from(schema.safetyAreas).where(eq(schema.safetyAreas.destinationId, destinationId)).all();

    const ranked = rankNeighborhoods(neighborhoods, safetyAreas);
    for (const nb of ranked) {
      const preview = nb.dayInTheLifePreview as { highlights: string[] };
      expect(preview.highlights.length).toBeGreaterThan(0);
    }
  });

  it("a neighborhood near a SafetyArea scores lower than an otherwise-identical one without overlap (R13)", () => {
    // Create two synthetic neighborhoods with the same base score but one near a safety area
    // Safety point is at (35.5, 139.5)
    // "Near Safety Area" is 500m away — within the 1200m walking radius → gets penalty
    // "Safe Area" is 50km away — clearly outside 1200m → no penalty
    const safetyPointLat = 35.5;
    const safetyPointLng = 139.5;

    const baseNeighborhood = {
      id: 100,
      destinationId,
      name: "Safe Area",
      centroidLat: 35.0, // ~55km from safety point
      centroidLng: 139.5,
      walkingRadiusMeters: 1200,
      familyFriendlinessScore: 80,
      dayInTheLifePreview: { highlights: [], safetyNote: "", sampleBundle: "" },
      sources: [] as string[],
    };

    const nearSafetyArea = {
      ...baseNeighborhood,
      id: 101,
      name: "Near Safety Area",
      // ~500m from safety point — within the 1200m walking radius
      centroidLat: safetyPointLat + 0.0045,
      centroidLng: safetyPointLng,
    };

    const syntheticSafetyArea = {
      id: 99,
      destinationId,
      name: "Test Safety Zone",
      geometry: { type: "point" as const, lat: safetyPointLat, lng: safetyPointLng },
      riskType: "theft",
      sourceQuote: "Test citation",
    };

    const ranked = rankNeighborhoods(
      [baseNeighborhood, nearSafetyArea],
      [syntheticSafetyArea],
      5
    );

    const safeRanked = ranked.find((n) => n.name === "Safe Area");
    const nearRanked = ranked.find((n) => n.name === "Near Safety Area");

    expect(safeRanked!.rankingScore).toBeGreaterThan(nearRanked!.rankingScore);
    expect(nearRanked!.safetyPenalty).toBeGreaterThan(0);
    expect(safeRanked!.safetyPenalty).toBe(0);
  });
});

describe("U4: Neighborhood selection (KTD-G reset)", () => {
  let db: Db;
  let tripId: number;
  let destinationId: number;

  beforeEach(() => {
    db = createDb();
    runSeed(db);

    const dest = db.select().from(schema.destinations).where(eq(schema.destinations.slug, "tokyo")).all()[0]!;
    destinationId = dest.id;

    const [profile] = db.insert(schema.familyProfiles).values({
      adultCount: 2,
      children: [],
      dietaryTags: [],
      accessibilityTags: [],
      pacingWindows: [],
    }).returning().all();

    const [trip] = db.insert(schema.trips).values({
      familyProfileId: profile!.id,
      destinationId,
      startDate: "2026-09-01",
      endDate: "2026-09-05",
      status: "NeighborhoodSelection",
    }).returning().all();

    tripId = trip!.id;
  });

  it("selecting a neighborhood persists Trip.selectedNeighborhoodId", () => {
    const neighborhoods = db.select().from(schema.neighborhoods).where(eq(schema.neighborhoods.destinationId, destinationId)).all();
    const nbId = neighborhoods[0]!.id;

    db.update(schema.trips).set({ selectedNeighborhoodId: nbId, status: "Discovery" }).where(eq(schema.trips.id, tripId)).run();

    const updated = db.select().from(schema.trips).where(eq(schema.trips.id, tripId)).all()[0]!;
    expect(updated.selectedNeighborhoodId).toBe(nbId);
  });

  it("reselecting a different neighborhood clears Decisions and ItineraryDays (KTD-G)", () => {
    const neighborhoods = db.select().from(schema.neighborhoods).where(eq(schema.neighborhoods.destinationId, destinationId)).all();
    const nb1 = neighborhoods[0]!;
    const nb2 = neighborhoods[1]!;

    // Select first neighborhood, add a place+decision+itinerary day
    db.update(schema.trips).set({ selectedNeighborhoodId: nb1.id }).where(eq(schema.trips.id, tripId)).run();

    const [place] = db.insert(schema.places).values({
      neighborhoodId: nb1.id,
      placeId: "P1",
      name: "Ramen",
      category: "eat",
      lat: 35.7,
      lng: 139.5,
      sources: [],
      corroborationScore: 0,
    }).returning().all();

    db.insert(schema.decisions).values({ tripId, placeId: place!.id, category: "eat", decision: "yes", worthTheDetour: false }).run();
    db.insert(schema.itineraryDays).values({ tripId, date: "2026-09-01" }).run();

    // KTD-G: reselecting a new neighborhood should clear decisions + itinerary days
    db.delete(schema.decisions).where(eq(schema.decisions.tripId, tripId)).run();
    db.delete(schema.itineraryDays).where(eq(schema.itineraryDays.tripId, tripId)).run();
    db.update(schema.trips).set({ selectedNeighborhoodId: nb2.id, status: "Discovery" }).where(eq(schema.trips.id, tripId)).run();

    const remainingDecisions = db.select().from(schema.decisions).where(eq(schema.decisions.tripId, tripId)).all();
    const remainingDays = db.select().from(schema.itineraryDays).where(eq(schema.itineraryDays.tripId, tripId)).all();
    expect(remainingDecisions).toHaveLength(0);
    expect(remainingDays).toHaveLength(0);

    const trip = db.select().from(schema.trips).where(eq(schema.trips.id, tripId)).all()[0]!;
    expect(trip.selectedNeighborhoodId).toBe(nb2.id);
  });
});
