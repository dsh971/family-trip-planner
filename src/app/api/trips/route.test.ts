import { describe, it, expect, vi, beforeEach } from "vitest";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import Database from "better-sqlite3";
import * as schema from "@/db/schema";
import path from "path";

// Resolve migrations relative to this file's repo root
const MIGRATIONS_FOLDER = path.resolve(__dirname, "../../../db/migrations");

function createDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db;
}

type Db = ReturnType<typeof createDb>;

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

// We mock @/db/client so the route uses our in-memory DB
vi.mock("@/db/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/db/client")>();
  return {
    ...original,
    getDb: vi.fn(),
  };
});

async function makeRequest(body: Record<string, unknown>) {
  const { POST } = await import("./route");
  const req = new Request("http://localhost/api/trips", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return POST(req);
}

describe("POST /api/trips", () => {
  let db: Db;

  beforeEach(async () => {
    db = createDb();
    const { getDb } = await import("@/db/client");
    vi.mocked(getDb).mockReturnValue(db as ReturnType<typeof import("@/db/client").getDb>);
  });

  // U2 (plan 2026-08-20-011): profile no longer sends a hardcoded destinationId: 1.
  // Instead it sends a free-text destinationName, which the route resolves via
  // findOrCreateDestination — this covers that resolution path end to end.
  it("creates a destination row and trip from a destinationName, not a hardcoded id", async () => {
    const profile = seedProfile(db);

    const res = await makeRequest({
      familyProfileId: profile.id,
      destinationName: "Kyoto",
      destinationCountry: "Japan",
      startDate: "2026-09-01",
      endDate: "2026-09-07",
    });

    expect(res.status).toBe(201);
    const json = await res.json() as { id: number; destinationId: number };
    expect(json.destinationId).toBeDefined();

    const destRows = db
      .select()
      .from(schema.destinations)
      .where(eq(schema.destinations.id, json.destinationId))
      .all();
    expect(destRows).toHaveLength(1);
    expect(destRows[0]!.name).toBe("Kyoto");
    expect(destRows[0]!.country).toBe("Japan");
    expect(destRows[0]!.slug).toBe("kyoto");
  });

  it("reuses an existing destination row for a name that already exists (by slug)", async () => {
    const profile = seedProfile(db);
    const existing = db
      .insert(schema.destinations)
      .values({
        slug: "paris",
        name: "Paris",
        country: "France",
        defaultWalkingRadiusMeters: 1200,
        localeValidators: [],
        safetyDataSource: "",
      })
      .returning()
      .all()[0]!;

    const res = await makeRequest({
      familyProfileId: profile.id,
      destinationName: "  paris ",
      startDate: "2026-09-01",
      endDate: "2026-09-07",
    });

    expect(res.status).toBe(201);
    const json = await res.json() as { destinationId: number };
    expect(json.destinationId).toBe(existing.id);

    const allDestinations = db.select().from(schema.destinations).all();
    expect(allDestinations).toHaveLength(1);
  });

  it("rejects an empty destinationName with a 400, not a silently-defaulted trip", async () => {
    const profile = seedProfile(db);

    const res = await makeRequest({
      familyProfileId: profile.id,
      destinationName: "   ",
      startDate: "2026-09-01",
      endDate: "2026-09-07",
    });

    expect(res.status).toBe(400);
    const json = await res.json() as { errors: Array<{ field: string }> };
    expect(json.errors.some((e) => e.field === "destinationName")).toBe(true);
  });

  it("still accepts a numeric destinationId directly (backward-compatible path)", async () => {
    const profile = seedProfile(db);
    const dest = db
      .insert(schema.destinations)
      .values({
        slug: "tokyo",
        name: "Tokyo",
        country: "Japan",
        defaultWalkingRadiusMeters: 1200,
        localeValidators: ["tabelog"],
        safetyDataSource: "OSAC Japan 2024",
      })
      .returning()
      .all()[0]!;

    const res = await makeRequest({
      familyProfileId: profile.id,
      destinationId: dest.id,
      startDate: "2026-09-01",
      endDate: "2026-09-07",
    });

    expect(res.status).toBe(201);
    const json = await res.json() as { destinationId: number };
    expect(json.destinationId).toBe(dest.id);
  });
});
