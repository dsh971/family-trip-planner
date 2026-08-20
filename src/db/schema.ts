import {
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

// ---------------------------------------------------------------------------
// Destination — extensibility anchor (R6). One row per supported city.
// Rows are created dynamically on demand from free-text entry (see
// src/services/destinations/lookup.ts's findOrCreateDestination(), plan
// 2026-08-20-011 U1) — src/data/{city}/ + src/db/seed.ts is now just a
// dev/demo fallback for pre-populating fixtures, not the only path.
// ---------------------------------------------------------------------------
export const destinations = sqliteTable("destinations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  // .unique() already creates a unique index (destinations_slug_unique, confirmed
  // in migrations/meta/0000_snapshot.json) — no additional index needed for U1.
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  country: text("country").notNull(),
  defaultWalkingRadiusMeters: integer("default_walking_radius_meters")
    .notNull()
    .default(1200),
  // JSON array: WG Stage-2 validators for this city, e.g. ["tabelog","hotpepper"]
  localeValidators: text("locale_validators", { mode: "json" })
    .$type<string[]>()
    .notNull(),
  // Citation string for the SafetyArea seed entries (e.g. OSAC report URL)
  safetyDataSource: text("safety_data_source").notNull(),
  // Neighborhood-discovery research stage (U5). "not_started" | "in_progress"
  // | "partial" | "complete" — see docs/plans/2026-08-20-011 state machine.
  researchStatus: text("research_status").notNull().default("not_started"),
  // Timestamp when the current/most-recent neighborhood-discovery run began.
  researchStartedAt: integer("research_started_at", { mode: "timestamp" }),
  // Timestamp when neighborhood-discovery last completed (fully or partially).
  // Staleness shape follows places.enrichedAt: nullable, set on completion,
  // compared against a 90-day TTL by the U4 orchestrator to trigger re-research.
  researchedAt: integer("researched_at", { mode: "timestamp" }),
  // IANA timezone identifier for this destination, e.g. "Asia/Tokyo",
  // "Europe/Paris" (plan 2026-08-20-011 U9 calendar-export audit). Nullable
  // and not yet populated/required anywhere — now that destinations are
  // arbitrary (not just Tokyo), itinerarySegments.startTime/endTime ("HH:MM"
  // wall-clock strings) are ambiguous without knowing which zone they're in.
  // This column gives a future calendar-export unit somewhere to read that
  // from; it does not itself change how times are computed or displayed.
  timezone: text("timezone"),
});

// ---------------------------------------------------------------------------
// FamilyProfile — composition, dietary/accessibility needs, pacing windows
// ---------------------------------------------------------------------------
export const familyProfiles = sqliteTable("family_profiles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  adultCount: integer("adult_count").notNull(),
  // JSON: [{ age: number }, ...]
  children: text("children", { mode: "json" })
    .$type<Array<{ age: number }>>()
    .notNull()
    .default([]),
  // JSON: string[] e.g. ["vegetarian", "nut-allergy"]
  dietaryTags: text("dietary_tags", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .default([]),
  // JSON: string[] e.g. ["wheelchair", "stroller"]
  accessibilityTags: text("accessibility_tags", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .default([]),
  // JSON: Array<{ name: string; startTime: string; endTime: string }>
  // e.g. [{ name: "nap", startTime: "13:00", endTime: "15:00" }]
  pacingWindows: text("pacing_windows", { mode: "json" })
    .$type<Array<{ name: string; startTime: string; endTime: string }>>()
    .notNull()
    .default([]),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// ---------------------------------------------------------------------------
// Trip — ties a FamilyProfile to a Destination, holds the lodging anchor
// ---------------------------------------------------------------------------
export const trips = sqliteTable("trips", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  familyProfileId: integer("family_profile_id")
    .notNull()
    .references(() => familyProfiles.id, { onDelete: "restrict" }),
  destinationId: integer("destination_id")
    .notNull()
    .references(() => destinations.id, { onDelete: "restrict" }),
  selectedNeighborhoodId: integer("selected_neighborhood_id"),
  startDate: text("start_date").notNull(), // ISO date string "YYYY-MM-DD"
  endDate: text("end_date").notNull(),
  // Hotel name as entered by the user (not geocoded). Nullable — user may skip.
  hotelName: text("hotel_name"),
  // Nullable until provided by the user at trip setup (KTD-H)
  lodgingAnchorLat: real("lodging_anchor_lat"),
  lodgingAnchorLng: real("lodging_anchor_lng"),
  lodgingAnchorAddress: text("lodging_anchor_address"),
  // "ProfileSetup" | "NeighborhoodSelection" | "Discovery" | "DecisionMaking"
  // | "ItineraryBuilt" | "TripInProgress"
  status: text("status").notNull().default("ProfileSetup"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// ---------------------------------------------------------------------------
// Neighborhood — scoped to a Destination (R6)
// ---------------------------------------------------------------------------
export const neighborhoods = sqliteTable(
  "neighborhoods",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    destinationId: integer("destination_id")
      .notNull()
      .references(() => destinations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    centroidLat: real("centroid_lat").notNull(),
    centroidLng: real("centroid_lng").notNull(),
    walkingRadiusMeters: integer("walking_radius_meters").notNull(),
    familyFriendlinessScore: integer("family_friendliness_score").notNull(),
    // JSON: { vibeTagline?: string; highlights: string[]; safetyNote: string; sampleBundle: string }
    dayInTheLifePreview: text("day_in_the_life_preview", { mode: "json" })
      .$type<{
        vibeTagline?: string;
        highlights: string[];
        safetyNote: string;
        sampleBundle: string;
      }>()
      .notNull(),
    // JSON: string[] — source publications that informed score + preview
    sources: text("sources", { mode: "json" })
      .$type<string[]>()
      .notNull(),
    // Place-research stage (U6). "not_started" | "in_progress" | "partial"
    // | "complete" — same enum shape as destinations.researchStatus, but
    // tracks this neighborhood's place-research pass, not the destination's
    // neighborhood-discovery pass. See docs/plans/2026-08-20-011 state machine.
    researchStatus: text("research_status").notNull().default("not_started"),
    // Timestamp when the current/most-recent place-research run began.
    researchStartedAt: integer("research_started_at", { mode: "timestamp" }),
    // Timestamp when place-research last completed (fully or partially).
    // Shape follows places.enrichedAt; compared against the 90-day TTL by
    // the U4 orchestrator.
    researchedAt: integer("researched_at", { mode: "timestamp" }),
  },
  (table) => [
    // New for U1: neighborhoods had no unique constraint before this. Required
    // as the onConflictDoUpdate conflict target for U5/U6's incremental upsert
    // (mirroring places_place_id_neighborhood_idx) — without it, a research
    // pass re-run for the same destination would insert duplicate neighborhood
    // rows instead of updating in place.
    uniqueIndex("neighborhoods_destination_id_name_idx").on(
      table.destinationId,
      table.name
    ),
  ]
);

// ---------------------------------------------------------------------------
// SafetyArea — flagged districts per Destination (KTD-D, R13, R14)
// ---------------------------------------------------------------------------
export const safetyAreas = sqliteTable("safety_areas", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  destinationId: integer("destination_id")
    .notNull()
    .references(() => destinations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  // JSON: { type: "polygon"; coordinates: [lat, lng][] } | { type: "point"; lat: number; lng: number }
  geometry: text("geometry", { mode: "json" })
    .$type<
      | { type: "polygon"; coordinates: Array<[number, number]> }
      | { type: "point"; lat: number; lng: number }
    >()
    .notNull(),
  riskType: text("risk_type").notNull(), // e.g. "theft" | "assault" | "pickpocketing"
  sourceQuote: text("source_quote").notNull(), // OSAC citation line (KTD-D)
});

// ---------------------------------------------------------------------------
// Place — discovered eat/visit candidates; placeId is the durable key (KTD-C)
// ---------------------------------------------------------------------------
export const places = sqliteTable(
  "places",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    neighborhoodId: integer("neighborhood_id")
      .notNull()
      .references(() => neighborhoods.id, { onDelete: "cascade" }),
    // Google Places placeId — only field permitted for indefinite storage (KTD-C)
    placeId: text("place_id").notNull(),
    name: text("name").notNull(),
    category: text("category").notNull(), // "eat" | "visit"
    lat: real("lat").notNull(),
    lng: real("lng").notNull(),
    // Refresh-on-demand fields — subject to Google Places caching limits (KTD-C)
    rating: real("rating"),
    reviewCount: integer("review_count"),
    priceLevel: integer("price_level"),
    // JSON: string[] — Google Places types array
    types: text("types", { mode: "json" }).$type<string[]>().notNull().default([]),
    goodForChildren: integer("good_for_children", { mode: "boolean" }),
    menuForChildren: integer("menu_for_children", { mode: "boolean" }),
    // JSON: string[] — values: "google-places-text-search" | "wanderlust-goat" | "tabelog"
    sources: text("sources", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default([]),
    // Count of independent sources that mention this place (KTD-C)
    corroborationScore: integer("corroboration_score").notNull().default(0),
    // JSON: Array<{ startTime: string }> — persisted for consistent late-night filtering
    openingHours: text("opening_hours", { mode: "json" })
      .$type<Array<{ startTime: string }>>()
      .notNull()
      .default([]),
    // Timestamp when rating/reviewCount/location were last fetched
    enrichedAt: integer("enriched_at", { mode: "timestamp" }),
    // Resolved CDN URL for the place photo (lh3.googleusercontent.com)
    photoUrl: text("photo_url"),
    // AI-generated or editorial description of the place
    description: text("description"),
  },
  (table) => [uniqueIndex("places_place_id_neighborhood_idx").on(table.placeId, table.neighborhoodId)]
);

// ---------------------------------------------------------------------------
// Decision — user yes/no per eat/visit place (R7, R8, KTD-H)
// ---------------------------------------------------------------------------
export const decisions = sqliteTable(
  "decisions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    tripId: integer("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    placeId: integer("place_id")
      .notNull()
      .references(() => places.id, { onDelete: "cascade" }),
    category: text("category").notNull(), // "eat" | "visit"
    decision: text("decision").notNull(), // "yes" | "no"
    worthTheDetour: integer("worth_the_detour", { mode: "boolean" })
      .notNull()
      .default(false),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [uniqueIndex("decisions_trip_place_idx").on(table.tripId, table.placeId)]
);

// ---------------------------------------------------------------------------
// ItineraryDay — one row per calendar date in the trip range (KTD-K)
// ---------------------------------------------------------------------------
export const itineraryDays = sqliteTable("itinerary_days", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tripId: integer("trip_id")
    .notNull()
    .references(() => trips.id, { onDelete: "cascade" }),
  date: text("date").notNull(), // ISO date string "YYYY-MM-DD"
});

// ---------------------------------------------------------------------------
// ItinerarySegment — ordered, addressable segments within a day (KTD-K, KTD-F)
// ---------------------------------------------------------------------------
export const itinerarySegments = sqliteTable("itinerary_segments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  dayId: integer("day_id")
    .notNull()
    .references(() => itineraryDays.id, { onDelete: "cascade" }),
  // Sortable fractional string — insert between two segments without renumbering
  order: text("order").notNull(),
  // "place" | "pacing-block" | "route"
  segmentType: text("segment_type").notNull(),
  // Nullable for pacing-block and route segments
  placeId: integer("place_id").references(() => places.id, {
    onDelete: "set null",
  }),
  // "scheduled" | "skipped" | "deferred" | "unscheduled-today" | "unscheduled"
  adjustmentState: text("adjustment_state").notNull().default("scheduled"),
  // "HH:MM" wall-clock strings (plan 2026-08-20-011 U9 audit). Interpreted as
  // the trip's destination-local time, paired with the parent ItineraryDay's
  // `date` — NOT UTC and NOT the traveler's home timezone. Combined with
  // `date` this is a naive/floating local datetime: unambiguous for display
  // (today's only consumer), but a future calendar export (out of scope
  // here, see plan R3) needs an explicit zone to produce a correct iCal
  // DTSTART/DTEND, since destinations are no longer implicitly Asia/Tokyo.
  // See destinations.timezone.
  startTime: text("start_time"), // "HH:MM"
  endTime: text("end_time"), // "HH:MM"
  // Type-specific data: route polyline, place snapshot, pacing block name, etc.
  payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>(),
});

// ---------------------------------------------------------------------------
// Type exports for use in service layer
// ---------------------------------------------------------------------------
export type Destination = typeof destinations.$inferSelect;
export type NewDestination = typeof destinations.$inferInsert;
export type FamilyProfile = typeof familyProfiles.$inferSelect;
export type NewFamilyProfile = typeof familyProfiles.$inferInsert;
export type Trip = typeof trips.$inferSelect;
export type NewTrip = typeof trips.$inferInsert;
export type Neighborhood = typeof neighborhoods.$inferSelect;
export type NewNeighborhood = typeof neighborhoods.$inferInsert;
export type SafetyArea = typeof safetyAreas.$inferSelect;
export type NewSafetyArea = typeof safetyAreas.$inferInsert;
export type Place = typeof places.$inferSelect;
export type NewPlace = typeof places.$inferInsert;
export type Decision = typeof decisions.$inferSelect;
export type NewDecision = typeof decisions.$inferInsert;
export type ItineraryDay = typeof itineraryDays.$inferSelect;
export type NewItineraryDay = typeof itineraryDays.$inferInsert;
export type ItinerarySegment = typeof itinerarySegments.$inferSelect;
export type NewItinerarySegment = typeof itinerarySegments.$inferInsert;
