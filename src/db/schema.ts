import {
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

// ---------------------------------------------------------------------------
// Destination — extensibility anchor (R6). One row per supported city.
// Adding a new destination = adding one row here + a src/data/{city}/ dir.
// ---------------------------------------------------------------------------
export const destinations = sqliteTable("destinations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
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
export const neighborhoods = sqliteTable("neighborhoods", {
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
});

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
    // JSON: string[] — values: "google-places-text-search" | "wanderlust-goat"
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
