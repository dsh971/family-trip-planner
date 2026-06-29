import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import {
  decisions,
  places,
  trips,
  neighborhoods,
  familyProfiles,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import {
  checkDetourViability,
  buildNeighborhoodAnchor,
  derivePacingBudget,
} from "@/services/discovery/detour";

// GET /api/decisions?tripId=<id> — list all decisions (yes and no) for a trip
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tripId = Number(searchParams.get("tripId"));
  if (!tripId) {
    return NextResponse.json({ error: "tripId required" }, { status: 400 });
  }

  const db = getDb();
  const rows = db
    .select({
      id: decisions.id,
      placeId: decisions.placeId,
      category: decisions.category,
      decision: decisions.decision,
      worthTheDetour: decisions.worthTheDetour,
      updatedAt: decisions.updatedAt,
      placeName: places.name,
      placeGoogleId: places.placeId,
      lat: places.lat,
      lng: places.lng,
      rating: places.rating,
      priceLevel: places.priceLevel,
    })
    .from(decisions)
    .leftJoin(places, eq(decisions.placeId, places.id))
    .where(eq(decisions.tripId, tripId))
    .all();

  return NextResponse.json({ decisions: rows });
}

// POST /api/decisions — record a yes or no decision, optionally checking detour viability
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { tripId, placeId: googlePlaceId, action, worthTheDetour } = body as {
    tripId?: number;
    placeId?: string; // Google Places placeId (string)
    action?: "yes" | "no";
    worthTheDetour?: boolean;
  };

  if (!tripId || !googlePlaceId || !action) {
    return NextResponse.json({ error: "tripId, placeId, and action required" }, { status: 400 });
  }
  if (action !== "yes" && action !== "no") {
    return NextResponse.json({ error: "action must be 'yes' or 'no'" }, { status: 400 });
  }

  const db = getDb();

  const trip = db.select().from(trips).where(eq(trips.id, tripId)).all()[0];
  if (!trip) {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }

  // Resolve the numeric place.id from the Google placeId string
  const place = db.select().from(places).where(eq(places.placeId, googlePlaceId)).all()[0];
  if (!place) {
    return NextResponse.json({ error: "Place not found" }, { status: 404 });
  }

  // Check detour viability if the place is flagged "worth the detour"
  let detourResult: { viable: boolean; walkingMinutes: number | null; wgAvailable: boolean } | null = null;
  if (worthTheDetour && action === "yes") {
    const neighborhood = trip.selectedNeighborhoodId
      ? db
          .select()
          .from(neighborhoods)
          .where(eq(neighborhoods.id, trip.selectedNeighborhoodId))
          .all()[0]
      : null;

    const profile = db
      .select()
      .from(familyProfiles)
      .where(eq(familyProfiles.id, trip.familyProfileId))
      .all()[0];

    const fromName = trip.lodgingAnchorAddress
      ? trip.lodgingAnchorAddress
      : neighborhood
      ? buildNeighborhoodAnchor(neighborhood.name)
      : "Tokyo, Japan";

    const toName = `${place.name}, Tokyo, Japan`;
    const pacingBudget = profile
      ? derivePacingBudget(
          profile.pacingWindows as Array<{ name: string; startTime: string; endTime: string }>
        )
      : 45;

    try {
      detourResult = await checkDetourViability({ fromName, toName, pacingBudgetMinutes: pacingBudget });
    } catch {
      // Non-WG errors don't block the decision — log and continue
      console.warn("[Decisions] Detour check failed — proceeding without route data");
    }
  }

  // Upsert decision (idempotent — re-deciding is allowed)
  const upserted = db
    .insert(decisions)
    .values({
      tripId,
      placeId: place.id,
      category: place.category,
      decision: action,
      worthTheDetour: worthTheDetour ?? false,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [decisions.tripId, decisions.placeId],
      set: {
        decision: action,
        worthTheDetour: worthTheDetour ?? false,
        updatedAt: new Date(),
      },
    })
    .returning()
    .all()[0];

  return NextResponse.json({
    decision: upserted,
    detourCheck: detourResult,
  });
}

// DELETE /api/decisions?tripId=<id>&placeId=<googlePlaceId> — remove a decision
export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const tripId = Number(searchParams.get("tripId"));
  const googlePlaceId = searchParams.get("placeId");

  if (!tripId || !googlePlaceId) {
    return NextResponse.json({ error: "tripId and placeId required" }, { status: 400 });
  }

  const db = getDb();

  const place = db.select().from(places).where(eq(places.placeId, googlePlaceId)).all()[0];
  if (!place) {
    return NextResponse.json({ error: "Place not found" }, { status: 404 });
  }

  db.delete(decisions)
    .where(and(eq(decisions.tripId, tripId), eq(decisions.placeId, place.id)))
    .run();

  return NextResponse.json({ deleted: true });
}
