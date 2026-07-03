import { describe, it, expect, vi, beforeEach } from "vitest";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import Database from "better-sqlite3";
import * as schema from "@/db/schema";
import path from "path";

// Resolve migrations relative to this file's repo root
const MIGRATIONS_FOLDER = path.resolve(__dirname, "../../../../db/migrations");

function createDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db;
}

type Db = ReturnType<typeof createDb>;

function seedDestination(db: Db) {
  return db
    .insert(schema.destinations)
    .values({
      slug: "tokyo",
      name: "Tokyo",
      country: "JP",
      defaultWalkingRadiusMeters: 1200,
      localeValidators: ["tabelog"],
      safetyDataSource: "OSAC Japan 2024",
    })
    .returning()
    .all()[0]!;
}

function seedProfile(db: Db) {
  return db
    .insert(schema.familyProfiles)
    .values({
      adultCount: 2,
      children: [{ age: 4 }, { age: 7 }],
      dietaryTags: [],
      accessibilityTags: [],
      pacingWindows: [],
    })
    .returning()
    .all()[0]!;
}

function seedTrip(
  db: Db,
  familyProfileId: number,
  destinationId: number,
  extra: Partial<typeof schema.trips.$inferInsert> = {}
) {
  return db
    .insert(schema.trips)
    .values({
      familyProfileId,
      destinationId,
      startDate: "2026-09-01",
      endDate: "2026-09-07",
      status: "NeighborhoodSelection",
      ...extra,
    })
    .returning()
    .all()[0]!;
}

// We mock @/db/client so the route uses our in-memory DB
vi.mock("@/db/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/db/client")>();
  return {
    ...original,
    getDb: vi.fn(),
  };
});

async function makeRequest(tripIdStr: string) {
  const { GET } = await import("./route");
  const req = new Request(`http://localhost/api/trips/${tripIdStr}`);
  return GET(req, { params: Promise.resolve({ tripId: tripIdStr }) });
}

describe("GET /api/trips/[tripId]", () => {
  let db: Db;

  beforeEach(async () => {
    db = createDb();
    const { getDb } = await import("@/db/client");
    vi.mocked(getDb).mockReturnValue(db as ReturnType<typeof import("@/db/client").getDb>);
  });

  it("returns 200 with trip and familyProfile for a valid trip", async () => {
    const dest = seedDestination(db);
    const profile = seedProfile(db);
    const trip = seedTrip(db, profile.id, dest.id, {
      hotelName: "Park Hyatt Tokyo",
      lodgingAnchorLat: 35.6896,
      lodgingAnchorLng: 139.6917,
      lodgingAnchorAddress: "Park Hyatt Tokyo, Shinjuku",
    });

    const res = await makeRequest(String(trip.id));
    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    expect(json.id).toBe(trip.id);
    expect(json.hotelName).toBe("Park Hyatt Tokyo");
    expect(json.lodgingAnchorLat).toBe(35.6896);
    expect(json.familyProfile).toBeDefined();
    const fp = json.familyProfile as Record<string, unknown>;
    expect(fp.adultCount).toBe(2);
    expect(fp.children).toHaveLength(2);
  });

  it("returns hotelName null when no hotel was set", async () => {
    const dest = seedDestination(db);
    const profile = seedProfile(db);
    const trip = seedTrip(db, profile.id, dest.id);

    const res = await makeRequest(String(trip.id));
    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    expect(json.hotelName).toBeNull();
    expect(json.lodgingAnchorLat).toBeNull();
  });

  it("returns 404 for a non-existent trip", async () => {
    const res = await makeRequest("9999");
    expect(res.status).toBe(404);
  });

  it("returns 400 for a non-integer tripId", async () => {
    const res = await makeRequest("abc");
    expect(res.status).toBe(400);
  });

  it("returns familyProfile with two children and correct ages", async () => {
    const dest = seedDestination(db);
    const profile = seedProfile(db);
    const trip = seedTrip(db, profile.id, dest.id);

    const res = await makeRequest(String(trip.id));
    const json = await res.json() as Record<string, unknown>;
    const fp = json.familyProfile as Record<string, unknown>;
    const children = fp.children as Array<{ age: number }>;
    expect(children[0]?.age).toBe(4);
    expect(children[1]?.age).toBe(7);
  });
});
