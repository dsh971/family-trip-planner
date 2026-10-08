// One-time backfill for Google-sourced `places` rows affected by the
// getPlaceDetails field-name bug (plan 2026-10-08-001 U1): re-fetches
// opening_hours/description for rows that still look unattempted, without
// re-running Text Search/corroboration or touching hand-seeded rows.
//
// Invoke via `npm run db:backfill-place-details`.
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { getDb } from "@/db/client";
import { places, type Place } from "@/db/schema";
import * as schema from "@/db/schema";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { getPlaceDetails } from "@/services/discovery/places";
import { buildDetailsRefreshSet } from "@/services/discovery/research";
import { withConcurrencyLimit } from "@/services/research/concurrency";

type Db = ReturnType<typeof getDb>;

export interface BackfillSkip {
  placeId: string;
  neighborhoodId?: number;
  reason: string;
}

export interface BackfillSummary {
  scanned: number;
  updated: number;
  skipped: number;
  skips: BackfillSkip[];
}

// Rows sourced from Google Text Search (excludes hand-seeded rows, e.g. the
// Lisbon test fixtures) that still look unattempted: empty opening_hours or
// a null description. Re-run safe — a row with real data in both already
// doesn't match and is left alone.
function findBackfillTargets(db: Db): Place[] {
  return db
    .select()
    .from(places)
    .where(
      and(
        sql`${places.sources} LIKE ${'%"google-places-text-search"%'}`,
        or(eq(places.openingHours, []), isNull(places.description))
      )
    )
    .all();
}

export async function runBackfill(db: Db): Promise<BackfillSummary> {
  const targets = findBackfillTargets(db);
  const summary: BackfillSummary = { scanned: targets.length, updated: 0, skipped: 0, skips: [] };

  const rowsByPlaceId = new Map<string, Place[]>();
  for (const row of targets) {
    const bucket = rowsByPlaceId.get(row.placeId);
    if (bucket) {
      bucket.push(row);
    } else {
      rowsByPlaceId.set(row.placeId, [row]);
    }
  }

  const skipAll = (placeId: string, rows: Place[], reason: string) => {
    console.warn(`[Backfill] ${placeId}: skipped — ${reason}`);
    summary.skipped += rows.length;
    for (const row of rows) {
      summary.skips.push({ placeId, neighborhoodId: row.neighborhoodId, reason });
    }
  };

  await withConcurrencyLimit(
    [...rowsByPlaceId.entries()],
    async ([placeId, rows]) => {
      let details;
      try {
        details = await getPlaceDetails(placeId);
      } catch (err) {
        skipAll(placeId, rows, `getPlaceDetails threw — ${err instanceof Error ? err.message : err}`);
        return;
      }

      if (!details) {
        skipAll(placeId, rows, "Google returned no usable details");
        return;
      }

      const refresh = buildDetailsRefreshSet(details);

      for (const row of rows) {
        // Prefer the fresh fetch, but don't let a response that's merely
        // missing one field (not malformed, just doesn't have hours or a
        // summary this time) clobber an already-good value this row already
        // had from a prior successful backfill or research run.
        const nextOpeningHours = refresh.openingHours.length > 0 ? refresh.openingHours : row.openingHours;
        const nextDescription = refresh.description ?? row.description;

        try {
          const result = db
            .update(places)
            .set({ openingHours: nextOpeningHours, description: nextDescription })
            .where(and(eq(places.placeId, row.placeId), eq(places.neighborhoodId, row.neighborhoodId)))
            .run();

          if (result.changes > 0) {
            summary.updated += 1;
          } else {
            const reason = "update matched 0 rows (likely deleted mid-run)";
            console.warn(`[Backfill] ${placeId}/${row.neighborhoodId}: ${reason}`);
            summary.skipped += 1;
            summary.skips.push({ placeId, neighborhoodId: row.neighborhoodId, reason });
          }
        } catch (err) {
          const reason = `write failed — ${err instanceof Error ? err.message : err}`;
          console.warn(`[Backfill] ${placeId}/${row.neighborhoodId}: ${reason}`);
          summary.skipped += 1;
          summary.skips.push({ placeId, neighborhoodId: row.neighborhoodId, reason });
        }
      }
    },
    8
  );

  return summary;
}

// When run directly (not imported as a module)
if (process.argv[1] && process.argv[1].includes("backfill-place-details")) {
  if (!process.env.GOOGLE_PLACES_API_KEY) {
    console.error(
      '[Backfill] GOOGLE_PLACES_API_KEY is not set — refusing to run. Every row would otherwise silently log as "Google returned no usable details", indistinguishable from a genuine Google-side failure.'
    );
    process.exit(1);
  }

  const DB_PATH = process.env.DATABASE_URL ?? "./local.db";
  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  // Scoped to this script's own connection, not the shared app-wide getDb()
  // singleton — better-sqlite3 is synchronous, so a busy_timeout on a
  // request-serving connection would block the whole Node event loop under
  // write contention. This one-off script can afford to wait instead.
  sqlite.pragma("busy_timeout = 5000");
  const db = drizzle(sqlite, { schema });

  runBackfill(db)
    .then((summary) => {
      console.log(
        `[Backfill] scanned=${summary.scanned} updated=${summary.updated} skipped=${summary.skipped}`
      );
    })
    .catch((err) => {
      console.error("[Backfill] fatal:", err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
