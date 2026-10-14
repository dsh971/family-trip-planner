// Coverage for scripts/backfill-place-details.ts (plan 2026-10-08-001 U2).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import path from "path";
import * as schema from "@/db/schema";

const MIGRATIONS_FOLDER = path.resolve(__dirname, "../src/db/migrations");

function createDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db;
}

type Db = ReturnType<typeof createDb>;

vi.mock("@/services/discovery/places", () => ({
  getPlaceDetails: vi.fn(),
}));

import { getPlaceDetails } from "@/services/discovery/places";
import { runBackfill } from "./backfill-place-details";

function seedNeighborhood(db: Db, name = "Kichijoji") {
  const dest = db
    .insert(schema.destinations)
    .values({
      slug: `tokyo-${name}`,
      name: "Tokyo",
      country: "JP",
      defaultWalkingRadiusMeters: 1200,
      localeValidators: [],
      safetyDataSource: "OSAC 2024",
    })
    .returning()
    .all()[0]!;

  return db
    .insert(schema.neighborhoods)
    .values({
      destinationId: dest.id,
      name,
      centroidLat: 35.702,
      centroidLng: 139.58,
      walkingRadiusMeters: 800,
      familyFriendlinessScore: 90,
      dayInTheLifePreview: {
        highlights: ["Inokashira Park"],
        safetyNote: "Very safe",
        sampleBundle: "Park → lunch → shopping",
      },
      sources: ["timeout-tokyo"],
    })
    .returning()
    .all()[0]!;
}

function insertPlace(
  db: Db,
  neighborhoodId: number,
  overrides: Partial<typeof schema.places.$inferInsert> = {}
) {
  return db
    .insert(schema.places)
    .values({
      neighborhoodId,
      placeId: overrides.placeId ?? "ChIJ_default",
      name: overrides.name ?? "Test Place",
      category: overrides.category ?? "eat",
      lat: 35.702,
      lng: 139.58,
      sources: overrides.sources ?? ["google-places-text-search"],
      openingHours: overrides.openingHours ?? [],
      description: overrides.description ?? null,
      ...overrides,
    })
    .returning()
    .all()[0]!;
}

describe("runBackfill", () => {
  let db: Db;

  beforeEach(() => {
    db = createDb();
    vi.mocked(getPlaceDetails).mockReset();
  });

  it("selects a Google-sourced row with empty opening_hours and null description as a target", async () => {
    const neighborhood = seedNeighborhood(db);
    insertPlace(db, neighborhood.id, { placeId: "ChIJ_target" });
    vi.mocked(getPlaceDetails).mockResolvedValue({
      goodForChildren: null,
      menuForChildren: null,
      openingHours: [{ startTime: "09:00" }],
      description: "A cozy spot.",
    });

    const summary = await runBackfill(db);

    expect(summary.scanned).toBe(1);
    expect(summary.updated).toBe(1);
  });

  it("excludes a row whose sources do not include google-places-text-search", async () => {
    const neighborhood = seedNeighborhood(db);
    insertPlace(db, neighborhood.id, { placeId: "ChIJ_handseeded", sources: ["timeout-tokyo"] });

    const summary = await runBackfill(db);

    expect(summary.scanned).toBe(0);
    expect(getPlaceDetails).not.toHaveBeenCalled();
  });

  it("excludes a row that already has real opening_hours and description (already fixed)", async () => {
    const neighborhood = seedNeighborhood(db);
    insertPlace(db, neighborhood.id, {
      placeId: "ChIJ_already_fixed",
      openingHours: [{ startTime: "09:00" }],
      description: "Already has a description.",
    });

    const summary = await runBackfill(db);

    expect(summary.scanned).toBe(0);
    expect(getPlaceDetails).not.toHaveBeenCalled();
  });

  it("updates openingHours/description via the shared helper and leaves enrichedAt unchanged", async () => {
    const neighborhood = seedNeighborhood(db);
    const before = insertPlace(db, neighborhood.id, { placeId: "ChIJ_target" });
    vi.mocked(getPlaceDetails).mockResolvedValue({
      goodForChildren: null,
      menuForChildren: null,
      openingHours: [{ startTime: "11:00" }],
      description: "Great ramen.",
    });

    await runBackfill(db);

    const after = db
      .select()
      .from(schema.places)
      .where(eq(schema.places.id, before.id))
      .all()[0]!;
    expect(after.openingHours).toEqual([{ startTime: "11:00" }]);
    expect(after.description).toBe("Great ramen.");
    expect(after.enrichedAt).toEqual(before.enrichedAt);
  });

  it("dedupes getPlaceDetails calls by placeId across multiple neighborhoods", async () => {
    const n1 = seedNeighborhood(db, "Kichijoji");
    const n2 = seedNeighborhood(db, "Shimokitazawa");
    insertPlace(db, n1.id, { placeId: "ChIJ_shared" });
    insertPlace(db, n2.id, { placeId: "ChIJ_shared" });
    vi.mocked(getPlaceDetails).mockResolvedValue({
      goodForChildren: null,
      menuForChildren: null,
      openingHours: [{ startTime: "10:00" }],
      description: "Shared place.",
    });

    const summary = await runBackfill(db);

    expect(getPlaceDetails).toHaveBeenCalledTimes(1);
    expect(summary.scanned).toBe(2);
    expect(summary.updated).toBe(2);
  });

  it("skips a row when getPlaceDetails returns null, without throwing", async () => {
    const neighborhood = seedNeighborhood(db);
    insertPlace(db, neighborhood.id, { placeId: "ChIJ_unresolvable" });
    vi.mocked(getPlaceDetails).mockResolvedValue(null);

    const summary = await runBackfill(db);

    expect(summary.updated).toBe(0);
    expect(summary.skipped).toBe(1);
  });

  it("logs and skips a row whose UPDATE throws, without aborting the run", async () => {
    const neighborhood = seedNeighborhood(db);
    insertPlace(db, neighborhood.id, { placeId: "ChIJ_a" });
    insertPlace(db, neighborhood.id, { placeId: "ChIJ_b" });
    vi.mocked(getPlaceDetails).mockResolvedValue({
      goodForChildren: null,
      menuForChildren: null,
      openingHours: [{ startTime: "09:00" }],
      description: "Fine.",
    });

    const realUpdate = db.update.bind(db);
    let calls = 0;
    vi.spyOn(db, "update").mockImplementation((...args: Parameters<typeof db.update>) => {
      calls += 1;
      if (calls === 1) throw new Error("simulated write failure");
      return realUpdate(...args);
    });

    const summary = await runBackfill(db);

    expect(summary.scanned).toBe(2);
    expect(summary.skipped).toBe(1);
    expect(summary.updated).toBe(1);
  });

  it("logs and skips every row for a placeId whose getPlaceDetails call throws, without aborting the run", async () => {
    const neighborhood = seedNeighborhood(db);
    insertPlace(db, neighborhood.id, { placeId: "ChIJ_throws" });
    insertPlace(db, neighborhood.id, { placeId: "ChIJ_ok" });
    vi.mocked(getPlaceDetails).mockImplementation(async (placeId: string) => {
      if (placeId === "ChIJ_throws") throw new Error("simulated network error");
      return {
        goodForChildren: null,
        menuForChildren: null,
        openingHours: [{ startTime: "09:00" }],
        description: "Fine.",
      };
    });

    const summary = await runBackfill(db);

    expect(summary.scanned).toBe(2);
    expect(summary.skipped).toBe(1);
    expect(summary.updated).toBe(1);
    expect(summary.skips).toContainEqual(
      expect.objectContaining({ placeId: "ChIJ_throws", reason: expect.stringContaining("simulated network error") })
    );
  });

  it("preserves an already-good field when the fresh fetch only has data for its sibling field", async () => {
    const neighborhood = seedNeighborhood(db);
    const row = insertPlace(db, neighborhood.id, {
      placeId: "ChIJ_partial",
      openingHours: [{ startTime: "09:00" }],
      description: null,
    });
    // A fresh fetch that returns a description but no opening hours this
    // time should not null out the opening hours this row already had.
    vi.mocked(getPlaceDetails).mockResolvedValue({
      goodForChildren: null,
      menuForChildren: null,
      openingHours: [],
      description: "Newly found description.",
    });

    await runBackfill(db);

    const after = db
      .select()
      .from(schema.places)
      .where(eq(schema.places.id, row.id))
      .all()[0]!;
    expect(after.openingHours).toEqual([{ startTime: "09:00" }]);
    expect(after.description).toBe("Newly found description.");
  });

  it("does not miscount a row deleted between the initial select and its update", async () => {
    const neighborhood = seedNeighborhood(db);
    const row = insertPlace(db, neighborhood.id, { placeId: "ChIJ_deleted" });
    vi.mocked(getPlaceDetails).mockImplementation(async () => {
      // Simulate the row disappearing (e.g. neighborhood cascade-deleted)
      // between the initial SELECT and this row's UPDATE.
      db.delete(schema.places).where(eq(schema.places.id, row.id)).run();
      return {
        goodForChildren: null,
        menuForChildren: null,
        openingHours: [{ startTime: "09:00" }],
        description: "Will not land.",
      };
    });

    const summary = await runBackfill(db);

    expect(summary.updated).toBe(0);
    expect(summary.skipped).toBe(1);
  });
});
