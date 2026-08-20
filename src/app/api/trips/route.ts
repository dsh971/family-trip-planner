import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { trips } from "@/db/schema";
import { validateTrip } from "@/services/profile/validation";
import { geocodeHotelAddress, HotelNotFoundError } from "@/services/trips/geocoding";
import { findOrCreateDestination, InvalidDestinationNameError } from "@/services/destinations/lookup";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const bodyObj = body as Record<string, unknown>;
  const familyProfileId = typeof bodyObj.familyProfileId === "number" ? bodyObj.familyProfileId : null;
  if (!familyProfileId) {
    return NextResponse.json({ errors: [{ field: "familyProfileId", message: "Required" }] }, { status: 400 });
  }

  const db = getDb();

  // Resolve a free-text destination (name + optional country) into a real
  // destinationId via U1's findOrCreateDestination, when the caller doesn't already
  // have a numeric destinationId. This replaces the old hardcoded `destinationId: 1`
  // trip-creation payload (plan 2026-08-20-011 U2) — Profile now sends a destination
  // name instead. U3 will later replace this minimal name-based resolution with a
  // dedicated search/create UI and /api/destinations endpoint; this is the interim
  // path that unblocks trip creation for any destination in the meantime.
  let destinationId = typeof bodyObj.destinationId === "number" ? bodyObj.destinationId : undefined;
  if (destinationId === undefined && typeof bodyObj.destinationName === "string") {
    try {
      const destination = findOrCreateDestination(db, {
        name: bodyObj.destinationName,
        country: typeof bodyObj.destinationCountry === "string" ? bodyObj.destinationCountry : undefined,
      });
      destinationId = destination.id;
    } catch (err) {
      if (err instanceof InvalidDestinationNameError) {
        return NextResponse.json(
          { errors: [{ field: "destinationName", message: err.message }] },
          { status: 400 }
        );
      }
      throw err;
    }
  }

  const result = validateTrip({ ...bodyObj, destinationId });
  if (!result.valid) {
    return NextResponse.json({ errors: result.errors }, { status: 400 });
  }

  const tripData = result.data!;
  let lodgingAnchorLat: number | undefined;
  let lodgingAnchorLng: number | undefined;
  let lodgingAnchorAddress: string | undefined;

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

  const rows = db
    .insert(trips)
    .values({
      familyProfileId,
      destinationId: tripData.destinationId,
      startDate: tripData.startDate,
      endDate: tripData.endDate,
      hotelName: tripData.hotelName ?? null,
      lodgingAnchorLat,
      lodgingAnchorLng,
      lodgingAnchorAddress,
      status: "NeighborhoodSelection",
    })
    .returning()
    .all();

  return NextResponse.json(rows[0], { status: 201 });
}
