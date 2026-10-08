// One-time backfill for Google-sourced `places` rows affected by the
// getPlaceDetails field-name bug (plan 2026-10-08-001 U1): re-fetches
// opening_hours/description for rows that still look unattempted, without
// re-running Text Search/corroboration or touching hand-seeded rows.
//
// Invoke via `npm run db:backfill-place-details`.
import { getDb } from "@/db/client";
import { places, type Place } from "@/db/schema";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { getPlaceDetails } from "@/services/discovery/places";
import { buildDetailsRefreshSet } from "@/services/discovery/research";
import { withConcurrencyLimit } from "@/services/research/concurrency";

type Db = ReturnType<typeof getDb>;

export interface BackfillSummary {
  scanned: number;
  updated: number;
  skipped: number;
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
  const summary: BackfillSummary = { scanned: targets.length, updated: 0, skipped: 0 };

  const rowsByPlaceId = new Map<string, Place[]>();
  for (const row of targets) {
    const bucket = rowsByPlaceId.get(row.placeId);
    if (bucket) {
      bucket.push(row);
    } else {
      rowsByPlaceId.set(row.placeId, [row]);
    }
  }

  await withConcurrencyLimit(
    [...rowsByPlaceId.entries()],
    async ([placeId, rows]) => {
      let details;
      try {
        details = await getPlaceDetails(placeId);
      } catch (err) {
        console.warn(
          `[Backfill] ${placeId}: getPlaceDetails threw — ${err instanceof Error ? err.message : err}`
        );
        summary.skipped += rows.length;
        return;
      }

      if (!details) {
        console.warn(`[Backfill] ${placeId}: skipped — Google returned no usable details`);
        summary.skipped += rows.length;
        return;
      }

      const refresh = buildDetailsRefreshSet(details);

      for (const row of rows) {
        try {
          const result = db
            .update(places)
            .set(refresh)
            .where(and(eq(places.placeId, row.placeId), eq(places.neighborhoodId, row.neighborhoodId)))
            .run();

          if (result.changes > 0) {
            summary.updated += 1;
          } else {
            console.warn(
              `[Backfill] ${placeId}/${row.neighborhoodId}: update matched 0 rows (likely deleted mid-run)`
            );
            summary.skipped += 1;
          }
        } catch (err) {
          console.warn(
            `[Backfill] ${placeId}/${row.neighborhoodId}: write failed — ${err instanceof Error ? err.message : err}`
          );
          summary.skipped += 1;
        }
      }
    },
    8
  );

  return summary;
}

// When run directly (not imported as a module)
if (process.argv[1] && process.argv[1].includes("backfill-place-details")) {
  runBackfill(getDb()).then((summary) => {
    console.log(
      `[Backfill] scanned=${summary.scanned} updated=${summary.updated} skipped=${summary.skipped}`
    );
  });
}
