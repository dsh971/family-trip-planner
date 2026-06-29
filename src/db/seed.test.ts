import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import { resolve } from "path";
import * as schema from "./schema";
import { runSeed } from "./seed";

const MIGRATIONS_FOLDER = resolve(__dirname, "./migrations");

function createDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db;
}

describe("U3: Seed script", () => {
  it("seeds Tokyo: one Destination, 6 Neighborhoods, and SafetyAreas", () => {
    const db = createDb();
    runSeed(db);

    const destinations = db.select().from(schema.destinations).all();
    expect(destinations).toHaveLength(1);
    expect(destinations[0]!.slug).toBe("tokyo");

    const neighborhoods = db
      .select()
      .from(schema.neighborhoods)
      .where(eq(schema.neighborhoods.destinationId, destinations[0]!.id))
      .all();
    expect(neighborhoods.length).toBeGreaterThanOrEqual(5);
    expect(neighborhoods.length).toBeLessThanOrEqual(8);

    const safetyAreas = db
      .select()
      .from(schema.safetyAreas)
      .where(eq(schema.safetyAreas.destinationId, destinations[0]!.id))
      .all();
    expect(safetyAreas.length).toBeGreaterThan(0);
  });

  it("seed is idempotent — re-running does not duplicate rows", () => {
    const db = createDb();
    runSeed(db);
    runSeed(db);

    const destinations = db.select().from(schema.destinations).all();
    expect(destinations).toHaveLength(1);

    const neighborhoods = db.select().from(schema.neighborhoods).all();
    const firstRunCount = neighborhoods.length;
    runSeed(db);
    const neighborhoods2 = db.select().from(schema.neighborhoods).all();
    expect(neighborhoods2).toHaveLength(firstRunCount);
  });

  it("all neighborhoods have non-empty dayInTheLifePreview and sources (R2 + auditability)", () => {
    const db = createDb();
    runSeed(db);

    const neighborhoods = db.select().from(schema.neighborhoods).all();
    for (const nb of neighborhoods) {
      const preview = nb.dayInTheLifePreview as { highlights: string[]; safetyNote: string; sampleBundle: string };
      expect(preview.highlights.length).toBeGreaterThan(0);
      expect(preview.safetyNote.length).toBeGreaterThan(0);
      expect(preview.sampleBundle.length).toBeGreaterThan(0);
      const sources = nb.sources as string[];
      expect(sources.length).toBeGreaterThan(0);
    }
  });

  it("all familyFriendlinessScore values are distinct (ensures deterministic ranking)", () => {
    const db = createDb();
    runSeed(db);

    const neighborhoods = db.select().from(schema.neighborhoods).all();
    const scores = neighborhoods.map((n) => n.familyFriendlinessScore);
    const uniqueScores = new Set(scores);
    expect(uniqueScores.size).toBe(scores.length);
  });

  it("no neighborhood centroid falls inside a seeded SafetyArea (sanity check)", () => {
    const db = createDb();
    runSeed(db);

    const neighborhoods = db.select().from(schema.neighborhoods).all();
    const safetyAreas = db.select().from(schema.safetyAreas).all();

    // Simple proximity check: if a neighborhood centroid is within 300m of a safety area point, flag it
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

    for (const nb of neighborhoods) {
      for (const sa of safetyAreas) {
        const geo = sa.geometry as { type: string; lat?: number; lng?: number };
        if (geo.type === "point" && geo.lat !== undefined && geo.lng !== undefined) {
          const dist = haversineMeters(nb.centroidLat, nb.centroidLng, geo.lat, geo.lng);
          expect(dist).toBeGreaterThan(300); // neighborhood centroid is not inside a flagged area
        }
      }
    }
  });

  it("all neighborhood sources arrays contain at least one Tier 1 or Tier 2 source", () => {
    const db = createDb();
    runSeed(db);

    const tier1or2Keywords = [
      "Time Out",
      "Lonely Planet",
      "Condé Nast",
      "Japan with Kids",
      "Tokyo with Kids",
      "Japan Times",
    ];

    const neighborhoods = db.select().from(schema.neighborhoods).all();
    for (const nb of neighborhoods) {
      const sources = nb.sources as string[];
      const hasQualitySource = sources.some((s) =>
        tier1or2Keywords.some((kw) => s.includes(kw))
      );
      expect(hasQualitySource, `Neighborhood "${nb.name}" has no Tier 1/2 source`).toBe(true);
    }
  });

  it("SafetyArea entries each have an OSAC citation in sourceQuote", () => {
    const db = createDb();
    runSeed(db);

    const safetyAreas = db.select().from(schema.safetyAreas).all();
    expect(safetyAreas.length).toBeGreaterThan(0);
    for (const sa of safetyAreas) {
      expect(sa.sourceQuote.toLowerCase()).toMatch(/osac/);
    }
  });
});
