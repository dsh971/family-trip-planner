CREATE TABLE `decisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`trip_id` integer NOT NULL,
	`place_id` integer NOT NULL,
	`category` text NOT NULL,
	`decision` text NOT NULL,
	`worth_the_detour` integer DEFAULT false NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`place_id`) REFERENCES `places`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `decisions_trip_place_idx` ON `decisions` (`trip_id`,`place_id`);--> statement-breakpoint
CREATE TABLE `destinations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`country` text NOT NULL,
	`default_walking_radius_meters` integer DEFAULT 1200 NOT NULL,
	`locale_validators` text NOT NULL,
	`safety_data_source` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `destinations_slug_unique` ON `destinations` (`slug`);--> statement-breakpoint
CREATE TABLE `family_profiles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`adult_count` integer NOT NULL,
	`children` text DEFAULT '[]' NOT NULL,
	`dietary_tags` text DEFAULT '[]' NOT NULL,
	`accessibility_tags` text DEFAULT '[]' NOT NULL,
	`pacing_windows` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `itinerary_days` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`trip_id` integer NOT NULL,
	`date` text NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `itinerary_segments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`day_id` integer NOT NULL,
	`order` text NOT NULL,
	`segment_type` text NOT NULL,
	`place_id` integer,
	`adjustment_state` text DEFAULT 'scheduled' NOT NULL,
	`start_time` text,
	`end_time` text,
	`payload` text,
	FOREIGN KEY (`day_id`) REFERENCES `itinerary_days`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`place_id`) REFERENCES `places`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `neighborhoods` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`destination_id` integer NOT NULL,
	`name` text NOT NULL,
	`centroid_lat` real NOT NULL,
	`centroid_lng` real NOT NULL,
	`walking_radius_meters` integer NOT NULL,
	`family_friendliness_score` integer NOT NULL,
	`day_in_the_life_preview` text NOT NULL,
	`sources` text NOT NULL,
	FOREIGN KEY (`destination_id`) REFERENCES `destinations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `places` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`neighborhood_id` integer NOT NULL,
	`place_id` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`lat` real NOT NULL,
	`lng` real NOT NULL,
	`rating` real,
	`review_count` integer,
	`price_level` integer,
	`types` text DEFAULT '[]' NOT NULL,
	`good_for_children` integer,
	`menu_for_children` integer,
	`sources` text DEFAULT '[]' NOT NULL,
	`corroboration_score` integer DEFAULT 0 NOT NULL,
	`enriched_at` integer,
	FOREIGN KEY (`neighborhood_id`) REFERENCES `neighborhoods`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `places_place_id_neighborhood_idx` ON `places` (`place_id`,`neighborhood_id`);--> statement-breakpoint
CREATE TABLE `safety_areas` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`destination_id` integer NOT NULL,
	`name` text NOT NULL,
	`geometry` text NOT NULL,
	`risk_type` text NOT NULL,
	`source_quote` text NOT NULL,
	FOREIGN KEY (`destination_id`) REFERENCES `destinations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `trips` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`family_profile_id` integer NOT NULL,
	`destination_id` integer NOT NULL,
	`selected_neighborhood_id` integer,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`lodging_anchor_lat` real,
	`lodging_anchor_lng` real,
	`lodging_anchor_address` text,
	`status` text DEFAULT 'ProfileSetup' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`family_profile_id`) REFERENCES `family_profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`destination_id`) REFERENCES `destinations`(`id`) ON UPDATE no action ON DELETE restrict
);
