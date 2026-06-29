import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import { readFileSync, readdirSync } from "fs";
import { join, resolve } from "path";
import * as schema from "./schema";

const DB_PATH = process.env.DATABASE_URL ?? "./local.db";
const MIGRATIONS_FOLDER = resolve(__dirname, "./migrations");
const DATA_DIR = resolve(__dirname, "../data");

interface NeighborhoodJson {
  name: string;
  centroid: { lat: number; lng: number };
  walkingRadiusMeters: number;
  familyFriendlinessScore: number;
  dayInTheLifePreview: {
    highlights: string[];
    safetyNote: string;
    sampleBundle: string;
  };
  sources: string[];
}

interface SafetyAreaJson {
  name: string;
  geometry:
    | { type: "polygon"; coordinates: Array<[number, number]> }
    | { type: "point"; lat: number; lng: number };
  riskType: string;
  sourceQuote: string;
}

interface DestinationJson {
  slug: string;
  name: string;
  country: string;
  defaultWalkingRadiusMeters: number;
  localeValidators: string[];
  safetyDataSource: string;
}

function validateDestinationJson(data: unknown, filePath: string): DestinationJson {
  const d = data as Record<string, unknown>;
  const required = ["slug", "name", "country", "defaultWalkingRadiusMeters", "localeValidators", "safetyDataSource"];
  for (const field of required) {
    if (d[field] === undefined || d[field] === null) {
      throw new Error(`Seed validation failed: ${filePath} is missing required field "${field}"`);
    }
  }
  if (!Array.isArray(d.localeValidators) || d.localeValidators.length === 0) {
    throw new Error(`Seed validation failed: ${filePath} — localeValidators must be a non-empty array`);
  }
  return d as unknown as DestinationJson;
}

function validateNeighborhoodsJson(data: unknown, filePath: string): NeighborhoodJson[] {
  if (!Array.isArray(data)) throw new Error(`${filePath} must be a JSON array`);
  for (let i = 0; i < data.length; i++) {
    const n = data[i] as Record<string, unknown>;
    if (!n.name) throw new Error(`${filePath}[${i}] missing name`);
    if (!n.dayInTheLifePreview) throw new Error(`${filePath}[${i}] missing dayInTheLifePreview (R2)`);
    if (!Array.isArray(n.sources) || (n.sources as string[]).length === 0) {
      throw new Error(`${filePath}[${i}] missing sources array (required for auditability)`);
    }
  }
  return data as NeighborhoodJson[];
}

export function runSeed(db: ReturnType<typeof drizzle>) {
  // Discover all city data directories (skip _template)
  const dirs = readdirSync(DATA_DIR).filter(
    (d) => d !== "_template" && !d.startsWith(".")
  );

  if (dirs.length === 0) {
    console.warn("No destination directories found under src/data/");
    return;
  }

  for (const cityDir of dirs) {
    const cityPath = join(DATA_DIR, cityDir);

    // Parse and validate destination.json
    const destFile = join(cityPath, "destination.json");
    const destJson = validateDestinationJson(
      JSON.parse(readFileSync(destFile, "utf-8")),
      destFile
    );

    // Upsert destination (idempotent)
    const existing = db
      .select()
      .from(schema.destinations)
      .where(eq(schema.destinations.slug, destJson.slug))
      .all();

    let destinationId: number;
    if (existing.length > 0) {
      destinationId = existing[0]!.id;
      db.update(schema.destinations)
        .set({
          name: destJson.name,
          country: destJson.country,
          defaultWalkingRadiusMeters: destJson.defaultWalkingRadiusMeters,
          localeValidators: destJson.localeValidators,
          safetyDataSource: destJson.safetyDataSource,
        })
        .where(eq(schema.destinations.slug, destJson.slug))
        .run();
    } else {
      const rows = db
        .insert(schema.destinations)
        .values({
          slug: destJson.slug,
          name: destJson.name,
          country: destJson.country,
          defaultWalkingRadiusMeters: destJson.defaultWalkingRadiusMeters,
          localeValidators: destJson.localeValidators,
          safetyDataSource: destJson.safetyDataSource,
        })
        .returning()
        .all();
      destinationId = rows[0]!.id;
    }

    // Seed neighborhoods (delete existing for this destination, re-insert)
    const nbFile = join(cityPath, "neighborhoods.json");
    const neighborhoods = validateNeighborhoodsJson(
      JSON.parse(readFileSync(nbFile, "utf-8")),
      nbFile
    );

    db.delete(schema.neighborhoods)
      .where(eq(schema.neighborhoods.destinationId, destinationId))
      .run();

    for (const nb of neighborhoods) {
      db.insert(schema.neighborhoods)
        .values({
          destinationId,
          name: nb.name,
          centroidLat: nb.centroid.lat,
          centroidLng: nb.centroid.lng,
          walkingRadiusMeters: nb.walkingRadiusMeters,
          familyFriendlinessScore: nb.familyFriendlinessScore,
          dayInTheLifePreview: nb.dayInTheLifePreview,
          sources: nb.sources,
        })
        .run();
    }

    // Seed safety areas
    const saFile = join(cityPath, "safety-areas.json");
    const safetyAreas = JSON.parse(readFileSync(saFile, "utf-8")) as SafetyAreaJson[];

    db.delete(schema.safetyAreas)
      .where(eq(schema.safetyAreas.destinationId, destinationId))
      .run();

    for (const sa of safetyAreas) {
      db.insert(schema.safetyAreas)
        .values({
          destinationId,
          name: sa.name,
          geometry: sa.geometry,
          riskType: sa.riskType,
          sourceQuote: sa.sourceQuote,
        })
        .run();
    }

    console.log(
      `Seeded ${destJson.name}: ${neighborhoods.length} neighborhoods, ${safetyAreas.length} safety areas`
    );
  }
}

// When run directly (not imported as a module)
if (process.argv[1] && process.argv[1].includes("seed")) {
  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  runSeed(db);
}
