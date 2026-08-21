ALTER TABLE `destinations` ADD `research_status` text DEFAULT 'not_started' NOT NULL;--> statement-breakpoint
ALTER TABLE `destinations` ADD `research_started_at` integer;--> statement-breakpoint
ALTER TABLE `destinations` ADD `researched_at` integer;--> statement-breakpoint
ALTER TABLE `neighborhoods` ADD `research_status` text DEFAULT 'not_started' NOT NULL;--> statement-breakpoint
ALTER TABLE `neighborhoods` ADD `research_started_at` integer;--> statement-breakpoint
ALTER TABLE `neighborhoods` ADD `researched_at` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `neighborhoods_destination_id_name_idx` ON `neighborhoods` (`destination_id`,`name`);--> statement-breakpoint
-- Backfill decision (plan 2026-08-20-011, U1, Risks & Dependencies):
-- destinations.researchStatus tracks the neighborhood-discovery stage. Any
-- existing destination that already has seeded neighborhoods (e.g. Tokyo, via
-- src/db/seed.ts) has effectively already completed that stage — backfilling
-- it to 'not_started' would make the U5 pipeline redundantly re-research a
-- destination that's already fully populated, on the very next visit. So we
-- backfill to 'complete' with researched_at = now for destinations that have
-- at least one neighborhood row, and leave genuinely empty destinations (if
-- any) at the 'not_started' default.
--
-- neighborhoods.researchStatus tracks the place-research stage (U6) instead.
-- src/db/seed.ts never seeds `places` — today's app fetches places live, per
-- trip, via the synchronous /api/discovery route, with no per-neighborhood
-- completion tracking to backfill from. So neighborhoods are deliberately
-- left at the 'not_started' default here; U6's first research pass for each
-- neighborhood will populate real status going forward.
UPDATE `destinations`
SET `research_status` = 'complete', `researched_at` = unixepoch()
WHERE `id` IN (SELECT DISTINCT `destination_id` FROM `neighborhoods`);