import { describe, it, expect, beforeEach } from "vitest";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import Database from "better-sqlite3";
import * as schema from "./schema";
import path from "path";

const MIGRATIONS_FOLDER = path.resolve(__dirname, "./migrations");

function createDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db;
}

type Db = ReturnType<typeof createDb>;

function ins<T>(result: T[]): T {
  const row = result[0];
  if (!row) throw new Error("Insert returned no rows");
  return row;
}

// Minimal seed helpers
function seedDestination(db: Db, slug = "tokyo") {
  return ins(
    db
      .insert(schema.destinations)
      .values({
        slug,
        name: slug === "tokyo" ? "Tokyo" : "Paris",
        country: slug === "tokyo" ? "JP" : "FR",
        defaultWalkingRadiusMeters: 1200,
        localeValidators: ["tabelog", "hotpepper"],
        safetyDataSource: "OSAC Japan Crime & Safety Report 2024",
      })
      .returning()
      .all()
  );
}

function seedNeighborhood(db: Db, destinationId: number, name = "Kichijoji") {
  return ins(
    db
      .insert(schema.neighborhoods)
      .values({
        destinationId,
        name,
        centroidLat: 35.7022,
        centroidLng: 139.5795,
        walkingRadiusMeters: 1200,
        familyFriendlinessScore: 85,
        dayInTheLifePreview: {
          highlights: ["Inokashira Park", "Ghibli Museum area"],
          safetyNote: "Generally safe for families.",
          sampleBundle: "Ramen at Musashino Supper Club + Inokashira Park",
        },
        sources: ["Time Out Tokyo", "Japan with Kids"],
      })
      .returning()
      .all()
  );
}

function seedProfile(db: Db) {
  return ins(
    db
      .insert(schema.familyProfiles)
      .values({
        adultCount: 2,
        children: [{ age: 4 }, { age: 7 }],
        dietaryTags: [],
        accessibilityTags: [],
        pacingWindows: [{ name: "nap", startTime: "13:00", endTime: "15:00" }],
      })
      .returning()
      .all()
  );
}

function seedTrip(db: Db, familyProfileId: number, destinationId: number) {
  return ins(
    db
      .insert(schema.trips)
      .values({
        familyProfileId,
        destinationId,
        startDate: "2026-09-01",
        endDate: "2026-09-07",
        status: "ProfileSetup",
      })
      .returning()
      .all()
  );
}

function seedPlace(db: Db, neighborhoodId: number, placeId: string, name = placeId) {
  return ins(
    db
      .insert(schema.places)
      .values({
        neighborhoodId,
        placeId,
        name,
        category: "eat",
        lat: 35.702,
        lng: 139.58,
        sources: ["google-places"],
        corroborationScore: 0,
      })
      .returning()
      .all()
  );
}

describe("U1: Schema and migrations", () => {
  let db: Db;

  beforeEach(() => {
    db = createDb();
  });

  it("migrations create all 9 tables with expected columns", () => {
    const dest = seedDestination(db);
    expect(dest.id).toBeGreaterThan(0);
    expect(dest.slug).toBe("tokyo");

    const profile = seedProfile(db);
    expect(profile.id).toBeGreaterThan(0);

    const trip = seedTrip(db, profile.id, dest.id);
    expect(trip.id).toBeGreaterThan(0);

    const neighborhood = seedNeighborhood(db, dest.id);
    expect(neighborhood.id).toBeGreaterThan(0);

    const safetyArea = ins(
      db
        .insert(schema.safetyAreas)
        .values({
          destinationId: dest.id,
          name: "Roppongi",
          geometry: { type: "point", lat: 35.6628, lng: 139.7314 },
          riskType: "assault",
          sourceQuote: "OSAC: Roppongi — assault and drink-spiking risk",
        })
        .returning()
        .all()
    );
    expect(safetyArea.id).toBeGreaterThan(0);

    const place = seedPlace(db, neighborhood.id, "ChIJabcdef", "Kichijoji Ramen");
    expect(place.id).toBeGreaterThan(0);

    const day = ins(
      db
        .insert(schema.itineraryDays)
        .values({ tripId: trip.id, date: "2026-09-01" })
        .returning()
        .all()
    );
    expect(day.id).toBeGreaterThan(0);

    const segment = ins(
      db
        .insert(schema.itinerarySegments)
        .values({
          dayId: day.id,
          order: "0.5",
          segmentType: "place",
          placeId: place.id,
          adjustmentState: "scheduled",
          startTime: "10:00",
          endTime: "11:00",
        })
        .returning()
        .all()
    );
    expect(segment.id).toBeGreaterThan(0);

    const decision = ins(
      db
        .insert(schema.decisions)
        .values({
          tripId: trip.id,
          placeId: place.id,
          category: "eat",
          decision: "yes",
          worthTheDetour: false,
        })
        .returning()
        .all()
    );
    expect(decision.id).toBeGreaterThan(0);
  });

  it("inserts an ItinerarySegment between two existing segments without renumbering (KTD-K)", () => {
    const dest = seedDestination(db);
    const profile = seedProfile(db);
    const trip = seedTrip(db, profile.id, dest.id);
    const neighborhood = seedNeighborhood(db, dest.id);

    const place1 = seedPlace(db, neighborhood.id, "A");
    const place2 = seedPlace(db, neighborhood.id, "B");
    const place3 = seedPlace(db, neighborhood.id, "C");

    const day = ins(
      db
        .insert(schema.itineraryDays)
        .values({ tripId: trip.id, date: "2026-09-01" })
        .returning()
        .all()
    );

    db.insert(schema.itinerarySegments)
      .values({ dayId: day.id, order: "1", segmentType: "place", placeId: place1.id, adjustmentState: "scheduled" })
      .run();
    db.insert(schema.itinerarySegments)
      .values({ dayId: day.id, order: "2", segmentType: "place", placeId: place3.id, adjustmentState: "scheduled" })
      .run();

    // Insert between order "1" and "2" using fractional string — no renumbering needed
    const between = ins(
      db
        .insert(schema.itinerarySegments)
        .values({ dayId: day.id, order: "1.5", segmentType: "place", placeId: place2.id, adjustmentState: "scheduled" })
        .returning()
        .all()
    );
    expect(between.order).toBe("1.5");

    const segments = db.select().from(schema.itinerarySegments).all();
    const orders = segments.map((s) => s.order);
    expect(orders).toContain("1");
    expect(orders).toContain("1.5");
    expect(orders).toContain("2");
  });

  it("allows inserting a second Destination without schema changes (R6 extensibility)", () => {
    const tokyo = seedDestination(db, "tokyo");
    const paris = seedDestination(db, "paris");
    expect(tokyo.slug).toBe("tokyo");
    expect(paris.slug).toBe("paris");
    const all = db.select().from(schema.destinations).all();
    expect(all).toHaveLength(2);
  });

  it("allows a Decision for a Place outside the selected Neighborhood (detour items)", () => {
    const dest = seedDestination(db);
    const profile = seedProfile(db);
    const trip = seedTrip(db, profile.id, dest.id);

    const nbA = seedNeighborhood(db, dest.id, "Kichijoji");
    const nbB = ins(
      db
        .insert(schema.neighborhoods)
        .values({
          destinationId: dest.id,
          name: "Shimokitazawa",
          centroidLat: 35.661,
          centroidLng: 139.668,
          walkingRadiusMeters: 800,
          familyFriendlinessScore: 70,
          dayInTheLifePreview: { highlights: [], safetyNote: "", sampleBundle: "" },
          sources: ["Time Out Tokyo"],
        })
        .returning()
        .all()
    );

    db.update(schema.trips)
      .set({ selectedNeighborhoodId: nbA.id })
      .where(eq(schema.trips.id, trip.id))
      .run();

    const detourPlace = ins(
      db
        .insert(schema.places)
        .values({
          neighborhoodId: nbB.id,
          placeId: "DETOUR_001",
          name: "Detour Restaurant",
          category: "eat",
          lat: 35.66,
          lng: 139.67,
          sources: ["wanderlust-goat"],
          corroborationScore: 3,
        })
        .returning()
        .all()
    );

    // Schema must not block decisions referencing a place outside the selected neighborhood
    expect(() => {
      db.insert(schema.decisions)
        .values({
          tripId: trip.id,
          placeId: detourPlace.id,
          category: "eat",
          decision: "yes",
          worthTheDetour: true,
        })
        .run();
    }).not.toThrow();
  });

  it("cascades Trip deletion to Decision and ItineraryDay rows", () => {
    const dest = seedDestination(db);
    const profile = seedProfile(db);
    const trip = seedTrip(db, profile.id, dest.id);
    const neighborhood = seedNeighborhood(db, dest.id);

    const place = seedPlace(db, neighborhood.id, "P1");
    db.insert(schema.decisions)
      .values({ tripId: trip.id, placeId: place.id, category: "eat", decision: "yes", worthTheDetour: false })
      .run();
    db.insert(schema.itineraryDays).values({ tripId: trip.id, date: "2026-09-01" }).run();

    db.delete(schema.trips).where(eq(schema.trips.id, trip.id)).run();

    const decisions = db.select().from(schema.decisions).where(eq(schema.decisions.tripId, trip.id)).all();
    const days = db.select().from(schema.itineraryDays).where(eq(schema.itineraryDays.tripId, trip.id)).all();
    expect(decisions).toHaveLength(0);
    expect(days).toHaveLength(0);
  });
});
