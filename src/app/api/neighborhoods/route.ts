import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { neighborhoods, safetyAreas, trips, decisions, itineraryDays } from "@/db/schema";
import { eq } from "drizzle-orm";
import { rankNeighborhoods } from "@/services/neighborhoods/ranking";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const destinationId = Number(searchParams.get("destinationId"));
  if (!destinationId) {
    return NextResponse.json({ error: "destinationId required" }, { status: 400 });
  }

  const db = getDb();
  const nbs = db.select().from(neighborhoods).where(eq(neighborhoods.destinationId, destinationId)).all();
  const sas = db.select().from(safetyAreas).where(eq(safetyAreas.destinationId, destinationId)).all();
  const ranked = rankNeighborhoods(nbs, sas, 5);

  return NextResponse.json(ranked);
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { tripId, neighborhoodId } = body as { tripId?: number; neighborhoodId?: number };
  if (!tripId || !neighborhoodId) {
    return NextResponse.json({ error: "tripId and neighborhoodId required" }, { status: 400 });
  }

  const db = getDb();

  // KTD-G: clear any existing decisions and itinerary days before updating the selection
  db.delete(decisions).where(eq(decisions.tripId, tripId)).run();
  db.delete(itineraryDays).where(eq(itineraryDays.tripId, tripId)).run();

  db.update(trips)
    .set({ selectedNeighborhoodId: neighborhoodId, status: "Discovery" })
    .where(eq(trips.id, tripId))
    .run();

  const updated = db.select().from(trips).where(eq(trips.id, tripId)).all()[0];
  return NextResponse.json(updated);
}
