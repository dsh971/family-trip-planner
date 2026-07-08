import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { trips, familyProfiles } from "@/db/schema";
import { eq } from "drizzle-orm";

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
