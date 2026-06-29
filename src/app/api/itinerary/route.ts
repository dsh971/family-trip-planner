import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import {
  trips,
  decisions,
  places,
  neighborhoods,
  safetyAreas,
  familyProfiles,
  itineraryDays,
  itinerarySegments,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { distributeDecisions, type DecisionItem } from "@/services/itinerary/scheduler";
import { computeDayRoutes } from "@/services/itinerary/routing";

// POST /api/itinerary — build or rebuild the itinerary for a trip
// Triggers scheduler + routing, persists ItineraryDays and ItinerarySegments.
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { tripId } = body as { tripId?: number };
  if (!tripId) {
    return NextResponse.json({ error: "tripId required" }, { status: 400 });
  }

  const db = getDb();

  const trip = db.select().from(trips).where(eq(trips.id, tripId)).all()[0];
  if (!trip) {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }

  const profile = db
    .select()
    .from(familyProfiles)
    .where(eq(familyProfiles.id, trip.familyProfileId))
    .all()[0];

  if (!profile) {
    return NextResponse.json({ error: "Family profile not found" }, { status: 404 });
  }

  const neighborhood = trip.selectedNeighborhoodId
    ? db.select().from(neighborhoods).where(eq(neighborhoods.id, trip.selectedNeighborhoodId)).all()[0]
    : null;

  const sas = db
    .select()
    .from(safetyAreas)
    .where(eq(safetyAreas.destinationId, trip.destinationId))
    .all();

  // Load all yes-decisions with place details
  const decisionRows = db
    .select({
      id: decisions.id,
      placeId: decisions.placeId,
      category: decisions.category,
      worthTheDetour: decisions.worthTheDetour,
      placeName: places.name,
      placeGoogleId: places.placeId,
      lat: places.lat,
      lng: places.lng,
    })
    .from(decisions)
    .leftJoin(places, eq(decisions.placeId, places.id))
    .where(and(eq(decisions.tripId, tripId), eq(decisions.decision, "yes")))
    .all();

  const eatDecisions: DecisionItem[] = decisionRows
    .filter((d) => d.category === "eat")
    .map((d) => ({
      id: d.id,
      placeId: d.placeId,
      placeName: d.placeName,
      placeGoogleId: d.placeGoogleId,
      category: "eat" as const,
      worthTheDetour: d.worthTheDetour ?? false,
      lat: d.lat,
      lng: d.lng,
    }));

  const visitDecisions: DecisionItem[] = decisionRows
    .filter((d) => d.category === "visit")
    .map((d) => ({
      id: d.id,
      placeId: d.placeId,
      placeName: d.placeName,
      placeGoogleId: d.placeGoogleId,
      category: "visit" as const,
      worthTheDetour: d.worthTheDetour ?? false,
      lat: d.lat,
      lng: d.lng,
    }));

  const schedule = distributeDecisions({
    startDate: trip.startDate,
    endDate: trip.endDate,
    pacingWindows: profile.pacingWindows as Array<{ name: string; startTime: string; endTime: string }>,
    eatDecisions,
    visitDecisions,
  });

  // Compute routes for each real day (not overflow)
  const realDays = schedule.filter((d) => d.date !== "overflow");
  const routesByDay = new Map<string, Awaited<ReturnType<typeof computeDayRoutes>>>();
  for (const day of realDays) {
    const placeSegments = day.segments
      .filter((s) => s.segmentType === "place" && s.placeId !== null)
      .map((s) => {
        const decision = decisionRows.find((d) => d.placeId === s.placeId);
        return {
          placeId: s.placeId,
          placeName: s.payload?.["placeName"] as string | null,
          lat: decision?.lat ?? null,
          lng: decision?.lng ?? null,
          segmentType: s.segmentType,
        };
      });

    const routes = await computeDayRoutes(placeSegments, sas);
    routesByDay.set(day.date, routes);
  }

  // Persist: delete existing days+segments (rebuild from scratch)
  db.delete(itineraryDays).where(eq(itineraryDays.tripId, tripId)).run();

  const persistedDays: Array<{
    date: string;
    dayId: number;
    segments: typeof itinerarySegments.$inferSelect[];
    routes: Awaited<ReturnType<typeof computeDayRoutes>>;
  }> = [];

  for (const day of realDays) {
    const dayRow = db
      .insert(itineraryDays)
      .values({ tripId, date: day.date })
      .returning()
      .all()[0];

    if (!dayRow) continue;

    const segs: typeof itinerarySegments.$inferSelect[] = [];
    for (const seg of day.segments) {
      const inserted = db
        .insert(itinerarySegments)
        .values({
          dayId: dayRow.id,
          order: seg.order,
          segmentType: seg.segmentType,
          placeId: seg.placeId,
          adjustmentState: seg.adjustmentState,
          startTime: seg.startTime,
          endTime: seg.endTime,
          payload: seg.payload ?? {},
        })
        .returning()
        .all()[0];
      if (inserted) segs.push(inserted);
    }

    persistedDays.push({
      date: day.date,
      dayId: dayRow.id,
      segments: segs,
      routes: routesByDay.get(day.date) ?? [],
    });
  }

  // Update trip status
  db.update(trips).set({ status: "ItineraryBuilt" }).where(eq(trips.id, tripId)).run();

  const overflowDay = schedule.find((d) => d.date === "overflow");

  return NextResponse.json({
    tripId,
    days: persistedDays,
    overflow: overflowDay?.segments ?? [],
    neighborhood: neighborhood?.name ?? null,
  });
}

// GET /api/itinerary?tripId=<id> — load persisted itinerary
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tripId = Number(searchParams.get("tripId"));
  if (!tripId) {
    return NextResponse.json({ error: "tripId required" }, { status: 400 });
  }

  const db = getDb();

  const trip = db.select().from(trips).where(eq(trips.id, tripId)).all()[0];
  if (!trip) {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }

  const neighborhood = trip.selectedNeighborhoodId
    ? db.select().from(neighborhoods).where(eq(neighborhoods.id, trip.selectedNeighborhoodId)).all()[0]
    : null;

  const days = db.select().from(itineraryDays).where(eq(itineraryDays.tripId, tripId)).all();
  const result = [];

  for (const day of days) {
    const segments = db
      .select()
      .from(itinerarySegments)
      .where(eq(itinerarySegments.dayId, day.id))
      .all()
      .sort((a, b) => (a.order < b.order ? -1 : 1));

    result.push({ date: day.date, dayId: day.id, segments });
  }

  return NextResponse.json({
    tripId,
    days: result,
    neighborhood: neighborhood?.name ?? null,
    status: trip.status,
  });
}
