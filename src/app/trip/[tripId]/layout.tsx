import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { trips, destinations } from "@/db/schema";
import { BottomNav } from "@/components/ui/BottomNav";
import { WebNav } from "@/components/ui/WebNav";

interface Props {
  children: React.ReactNode;
  params: Promise<{ tripId: string }>;
}

// Matches itinerary/page.tsx's own inline date-label helper (formatDayPill)
// — no shared date-formatting util exists yet in this codebase.
function formatShort(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export default async function TripLayout({ children, params }: Props) {
  const { tripId } = await params;

  // Trip-context chip data for WebNav (U2, plan 2026-08-23-002-feat-
  // hybrid-design-fidelity-gaps). Resolved here, server-side, rather than
  // via a new client-side fetch hook inside WebNav itself — this layout is
  // the one component that wraps every trip-scoped route and already
  // resolves tripId from the URL each navigation, so it's the natural spot
  // to also resolve the trip's destination/dates once and hand them down
  // as plain props (same fields the existing GET /api/trips/[tripId] route
  // already exposes, queried directly here instead of round-tripping
  // through that endpoint from a Server Component).
  let tripName: string | undefined;
  let tripDates: string | undefined;
  const tripIdNum = Number(tripId);
  if (Number.isInteger(tripIdNum) && tripIdNum > 0) {
    const db = getDb();
    const rows = db
      .select({
        destinationName: destinations.name,
        startDate: trips.startDate,
        endDate: trips.endDate,
      })
      .from(trips)
      .innerJoin(destinations, eq(trips.destinationId, destinations.id))
      .where(eq(trips.id, tripIdNum))
      .all();

    const row = rows[0];
    if (row) {
      tripName = row.destinationName;
      tripDates = `${formatShort(row.startDate)} – ${formatShort(row.endDate)}`;
    }
  }

  return (
    <>
      {/* Scrollable content area. Mobile: between AppHeader (44px) and
          BottomNav (64px). Desktop (>=1024px): between WebNav (64px) and
          nothing, since there's no bottom bar at that breakpoint. The
          top/bottom insets live in the `.trip-shell-inset` class
          (globals.css) since they change by breakpoint — everything else
          here stays inline per this project's documented @source
          limitation for structural layout (see globals.css). */}
      <div
        className="trip-shell-inset"
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          overflowY: "auto",
        }}
      >
        {children}
      </div>
      <BottomNav tripId={tripId} />
      <WebNav tripId={tripId} tripName={tripName} tripDates={tripDates} />
    </>
  );
}
