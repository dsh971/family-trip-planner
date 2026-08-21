import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { trips, familyProfiles } from "@/db/schema";
import { eq } from "drizzle-orm";
import { validateProfile, validateTrip } from "@/services/profile/validation";
import { geocodeHotelAddress, HotelNotFoundError } from "@/services/trips/geocoding";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ tripId: string }> }
) {
  const { tripId: tripIdStr } = await params;
  const tripId = Number(tripIdStr);
  if (!Number.isInteger(tripId) || tripId <= 0) {
    return NextResponse.json({ error: "Invalid tripId" }, { status: 400 });
  }

  const db = getDb();
  const rows = db
    .select()
    .from(trips)
    .innerJoin(familyProfiles, eq(trips.familyProfileId, familyProfiles.id))
    .where(eq(trips.id, tripId))
    .all();

  if (rows.length === 0) {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }

  const row = rows[0]!;
  return NextResponse.json({
    id: row.trips.id,
    status: row.trips.status,
    // Exposed so client pages (e.g. neighborhoods/page.tsx) can look up this trip's
    // real destination instead of hardcoding destinationId (plan 2026-08-20-011 U2).
    destinationId: row.trips.destinationId,
    // Exposed so client pages (e.g. discovery/page.tsx, plan 2026-08-20-011
    // U7) can open the U6 SSE research stream for this trip's selected
    // neighborhood without a second round-trip.
    selectedNeighborhoodId: row.trips.selectedNeighborhoodId,
    hotelName: row.trips.hotelName,
    lodgingAnchorLat: row.trips.lodgingAnchorLat,
    lodgingAnchorLng: row.trips.lodgingAnchorLng,
    lodgingAnchorAddress: row.trips.lodgingAnchorAddress,
    startDate: row.trips.startDate,
    endDate: row.trips.endDate,
    familyProfile: {
      id: row.family_profiles.id,
      adultCount: row.family_profiles.adultCount,
      children: row.family_profiles.children,
      dietaryTags: row.family_profiles.dietaryTags,
      accessibilityTags: row.family_profiles.accessibilityTags,
      pacingWindows: row.family_profiles.pacingWindows,
    },
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ tripId: string }> }
) {
  const { tripId: tripIdStr } = await params;
  const tripId = Number(tripIdStr);
  if (!Number.isInteger(tripId) || tripId <= 0) {
    return NextResponse.json({ error: "Invalid tripId" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const db = getDb();

  // Look up the trip first so we can validate against its *real* destinationId
  // rather than a hardcoded placeholder (plan 2026-08-20-011 U2) — this PATCH
  // endpoint doesn't change destination, but validateTrip's shape requires a
  // numeric destinationId, so we supply the trip's actual one.
  const trip = db.select().from(trips).where(eq(trips.id, tripId)).all()[0];
  if (!trip) {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }

  const profileResult = validateProfile(body);
  const tripResult = validateTrip({
    ...(body as Record<string, unknown>),
    destinationId: trip.destinationId,
  });

  const errors = [...profileResult.errors, ...tripResult.errors];
  if (errors.length > 0) {
    return NextResponse.json({ errors }, { status: 400 });
  }

  const profileData = profileResult.data!;
  const tripData = tripResult.data!;

  let lodgingAnchorLat: number | null = null;
  let lodgingAnchorLng: number | null = null;
  let lodgingAnchorAddress: string | null = null;

  if (tripData.hotelName && tripData.hotelAddress) {
    try {
      const geo = await geocodeHotelAddress(tripData.hotelName, tripData.hotelAddress);
      lodgingAnchorLat = geo.lat;
      lodgingAnchorLng = geo.lng;
      lodgingAnchorAddress = geo.formattedAddress;
    } catch (err) {
      if (err instanceof HotelNotFoundError) {
        return NextResponse.json(
          { errors: [{ field: "hotelAddress", message: err.message }] },
          { status: 422 }
        );
      }
      throw err;
    }
  }

  db.update(familyProfiles)
    .set({
      adultCount: profileData.adultCount,
      children: profileData.children,
      dietaryTags: profileData.dietaryTags,
      accessibilityTags: profileData.accessibilityTags,
      pacingWindows: profileData.pacingWindows,
    })
    .where(eq(familyProfiles.id, trip.familyProfileId))
    .run();

  db.update(trips)
    .set({
      startDate: tripData.startDate,
      endDate: tripData.endDate,
      hotelName: tripData.hotelName ?? null,
      lodgingAnchorLat,
      lodgingAnchorLng,
      lodgingAnchorAddress,
    })
    .where(eq(trips.id, tripId))
    .run();

  return NextResponse.json({ ok: true });
}
