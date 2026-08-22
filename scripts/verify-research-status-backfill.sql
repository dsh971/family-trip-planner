-- Post-deploy verification for migration 0005's research_status backfill
-- (src/db/migrations/0005_research_status_and_dynamic_destinations.sql).
--
-- Code review finding (2026-08-21, data-migration P2): the backfill itself
-- was verified correct against local dev data during review, but the
-- migration shipped with no runnable verification query for a real deploy.
-- Kept as a standalone script rather than appended to the migration file
-- itself — migration files are immutable once applied (drizzle tracks them
-- by hash in __drizzle_migrations), so this lives separately instead.
--
-- Run after `npm run db:migrate` completes:
--   sqlite3 <path-to-db> < scripts/verify-research-status-backfill.sql
--
-- Expect ZERO rows from every query below. Any row returned means the
-- backfill mismarked a destination's research_status relative to whether it
-- actually has neighborhoods.

-- Every destination with at least one neighborhood should be "complete".
SELECT d.id, d.slug, d.research_status, d.researched_at, COUNT(n.id) AS neighborhood_count
FROM destinations d
LEFT JOIN neighborhoods n ON n.destination_id = d.id
GROUP BY d.id
HAVING neighborhood_count > 0 AND d.research_status <> 'complete';

-- Every destination with zero neighborhoods should still be "not_started"
-- (the backfill must not have marked an empty destination "complete").
SELECT d.id, d.slug, d.research_status, d.researched_at, COUNT(n.id) AS neighborhood_count
FROM destinations d
LEFT JOIN neighborhoods n ON n.destination_id = d.id
GROUP BY d.id
HAVING neighborhood_count = 0 AND d.research_status = 'complete';
