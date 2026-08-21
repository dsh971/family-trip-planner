import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import { resolve } from "path";
import * as schema from "@/db/schema";
import { runSeed } from "@/db/seed";
import {
  findOrCreateDestination,
  slugify,
  InvalidDestinationNameError,
} from "./lookup";

const MIGRATIONS_FOLDER = resolve(__dirname, "../../db/migrations");

function createDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db;
}

type Db = ReturnType<typeof createDb>;

describe("U1: slugify", () => {
  it("lowercases, trims, and hyphenates whitespace", () => {
    expect(slugify("  Kyoto  ")).toBe("kyoto");
    expect(slugify("New York City")).toBe("new-york-city");
  });

  it("strips punctuation", () => {
    expect(slugify("São Paulo!")).toBe("são-paulo");
    expect(slugify("Washington, D.C.")).toBe("washington-dc");
  });

  it("collapses repeated whitespace/hyphens", () => {
    expect(slugify("Kyoto   Japan")).toBe("kyoto-japan");
  });
});

describe("U1: findOrCreateDestination", () => {
  let db: Db;

  beforeEach(() => {
    db = createDb();
  });

  it("creates a new destinations row with researchStatus defaulting to not_started", () => {
    const dest = findOrCreateDestination(db, { name: "Kyoto" });

    expect(dest.slug).toBe("kyoto");
    expect(dest.name).toBe("Kyoto");
    expect(dest.researchStatus).toBe("not_started");
    expect(dest.researchStartedAt).toBeNull();
    expect(dest.researchedAt).toBeNull();
    expect(dest.localeValidators).toEqual([]);

    const rows = db
      .select()
      .from(schema.destinations)
      .where(eq(schema.destinations.slug, "kyoto"))
      .all();
    expect(rows).toHaveLength(1);
  });

  it("returns the existing row for a slug that already exists, not a duplicate", () => {
    runSeed(db);
    const before = db.select().from(schema.destinations).all();

    const dest = findOrCreateDestination(db, { name: "Tokyo" });

    const after = db.select().from(schema.destinations).all();
    expect(after).toHaveLength(before.length);
    expect(dest.slug).toBe("tokyo");
  });

  it("normalizes name variants to the same slug and the same row", () => {
    const first = findOrCreateDestination(db, { name: "Kyoto" });
    const second = findOrCreateDestination(db, { name: "  kyoto  " });
    const third = findOrCreateDestination(db, { name: "KYOTO" });

    expect(second.id).toBe(first.id);
    expect(third.id).toBe(first.id);

    const rows = db
      .select()
      .from(schema.destinations)
      .where(eq(schema.destinations.slug, "kyoto"))
      .all();
    expect(rows).toHaveLength(1);
  });

  it("rejects empty or whitespace-only names", () => {
    expect(() => findOrCreateDestination(db, { name: "" })).toThrow(
      InvalidDestinationNameError
    );
    expect(() => findOrCreateDestination(db, { name: "   " })).toThrow(
      InvalidDestinationNameError
    );
  });

  it("round-trips through Drizzle with all new research-status columns", () => {
    const created = findOrCreateDestination(db, { name: "Osaka" });
    const readBack = db
      .select()
      .from(schema.destinations)
      .where(eq(schema.destinations.id, created.id))
      .all()[0]!;

    expect(readBack).toEqual(created);
    expect(readBack.researchStatus).toBe("not_started");
  });
});
