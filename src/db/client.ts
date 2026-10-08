import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

const DB_PATH = process.env.DATABASE_URL ?? "./local.db";

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  if (!_db) {
    const sqlite = new Database(DB_PATH);
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
    // A concurrent writer (another process, or a one-off script like
    // scripts/backfill-place-details.ts) would otherwise throw SQLITE_BUSY
    // immediately instead of waiting briefly for the lock to clear.
    sqlite.pragma("busy_timeout = 5000");
    _db = drizzle(sqlite, { schema });
  }
  return _db;
}

// For testing: create an in-memory database instance (not the singleton)
export function createTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  return drizzle(sqlite, { schema });
}
