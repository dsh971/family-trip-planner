import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { trips } from "@/db/schema";
import { validateTrip } from "@/services/profile/validation";
import { geocodeHotelAddress, HotelNotFoundError } from "@/services/trips/geocoding";

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

  const result = validateTrip(body);
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

  const db = getDb();
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
