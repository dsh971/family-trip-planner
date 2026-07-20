"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Card,
  CardBody,
  CardFooter,
  Button,
  Alert,
  Skeleton,
  EmptyState,
} from "@sumiui/react";
import StepProgress from "@/components/ui/StepProgress";

const NeighborhoodMap = dynamic(
  () => import("@/components/ui/NeighborhoodMap"),
  { ssr: false, loading: () => <div className="w-full h-full flex items-center justify-center" style={{ color: "var(--fg-3)" }}>Loading map…</div> }
);

interface DayInTheLifePreview {
  vibeTagline?: string;
  highlights: string[];
  safetyNote: string;
  sampleBundle: string;
}

interface RankedNeighborhood {
  id: number;
  name: string;
  familyFriendlinessScore: number;
  rankingScore: number;
  safetyPenalty: number;
  dayInTheLifePreview: DayInTheLifePreview;
  walkingRadiusMeters: number;
  centroidLat: number;
  centroidLng: number;
}

interface TripDetail {
  id: number;
  hotelName: string | null;
  lodgingAnchorLat: number | null;
  lodgingAnchorLng: number | null;
  startDate: string;
  endDate: string;
  familyProfile: {
    adultCount: number;
    children: Array<{ age: number }>;
  };
}

// Haversine distance in km, one decimal place
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) / 10;
}

// Conservative family walking pace: 80 m/min. Round to nearest 5, min 5.
function metersToMinutes(meters: number): string {
  return `~${Math.max(5, Math.round(meters / 80 / 5) * 5)}-min walk`;
}

function scoreToLabel(score: number): string {
  if (score >= 90) return "Top pick for families";
  if (score >= 80) return "Excellent for families";
  if (score >= 70) return "Great for families";
  return "Good for families";
}

function tripNights(startDate: string, endDate: string): number {
  const start = new Date(startDate);
  const end = new Date(endDate);
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
}

function formatTripDuration(nights: number): string {
  if (nights <= 0) return "your whole trip";
  return nights === 1 ? "1 night" : `${nights} nights`;
}

function formatChildrenAges(children: Array<{ age: number }>): string {
  if (children.length === 0) return "";
  const ages = children.map((c) => c.age);
  if (ages.length === 1) return `age ${ages[0]}`;
  const allButLast = ages.slice(0, -1).join(", ");
  return `ages ${allButLast} & ${ages[ages.length - 1]}`;
}

export default function NeighborhoodsPage() {
  const { tripId } = useParams<{ tripId: string }>();
  const router = useRouter();
  const [neighborhoods, setNeighborhoods] = useState<RankedNeighborhood[]>([]);
  const [trip, setTrip] = useState<TripDetail | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mapVisible, setMapVisible] = useState(false);
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const cardRefs = useRef<Map<number, HTMLElement>>(new Map());

  useEffect(() => {
    void (async () => {
      const [nbRes, tripRes] = await Promise.all([
        fetch("/api/neighborhoods?destinationId=1"),
        fetch(`/api/trips/${tripId}`),
      ]);

      if (!nbRes.ok) {
        setError("Failed to load neighborhoods");
        setLoading(false);
        return;
      }

      const data = await nbRes.json() as RankedNeighborhood[];
      setNeighborhoods(data);

      if (tripRes.ok) {
        const tripData = await tripRes.json() as TripDetail;
        setTrip(tripData);
      }
      // If trip fetch fails, we still show neighborhoods — hotel/family chips are simply absent.

      setLoading(false);
    })();
  }, [tripId]);

  async function handleSelect(neighborhoodId: number) {
    setSelected(neighborhoodId);
    setSubmitting(neighborhoodId);
    cardRefs.current.get(neighborhoodId)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    const res = await fetch("/api/neighborhoods", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tripId: Number(tripId), neighborhoodId }),
    });
    if (!res.ok) {
      setError("Failed to select neighborhood");
      setSubmitting(null);
      return;
    }
    router.push(`/trip/${tripId}/discovery`);
  }

  if (loading) {
    return (
      <main className="max-w-2xl mx-auto p-4 pt-6 space-y-4">
        <Skeleton height="1rem" width="10rem" />
        <Skeleton height="2rem" width="18rem" />
        <Skeleton height="1rem" width="22rem" />
        {[1, 2, 3].map((n) => (
          <Skeleton key={n} height="14rem" />
        ))}
      </main>
    );
  }

  if (error) {
    return (
      <main className="max-w-2xl mx-auto p-4 pt-6">
        <Alert variant="danger">{error}</Alert>
      </main>
    );
  }

  if (neighborhoods.length === 0) {
    return (
      <main className="max-w-2xl mx-auto p-4 pt-6">
        <EmptyState title="No neighborhoods found" description="No neighborhood data is available for this destination." />
      </main>
    );
  }

  const childrenAges = trip ? formatChildrenAges(trip.familyProfile.children) : null;
  const nights = trip ? tripNights(trip.startDate, trip.endDate) : 0;
  const mappedNeighborhoods = neighborhoods.map((nb, i) => ({ ...nb, rankPosition: i + 1 }));

  return (
    <main className="p-4 pt-6 pb-20 max-w-5xl mx-auto">
      <div className="mb-4">
        <StepProgress currentStep="area" tripId={tripId} />
      </div>

      <div className="mb-4 space-y-2">
        <h1
          className="text-2xl font-bold tracking-tight"
          style={{ fontFamily: "var(--font-display)", color: "var(--fg-1)" }}
        >
          Where do you want to explore?
        </h1>
        <p className="text-sm" style={{ color: "var(--fg-2)" }}>
          Choose the neighborhood you'll anchor your {formatTripDuration(nights)} around — activities
          and restaurants will cluster here, within walking distance.
        </p>

        {/* Context chips */}
        <div className="flex flex-wrap gap-2 mt-2">
          {trip?.hotelName && (
            <span
              className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs"
              style={{ background: "var(--bg-1)", color: "var(--fg-3)", border: "1px solid var(--line-1)" }}
            >
              🏨 Staying at: {trip.hotelName}
            </span>
          )}
          {trip && (
            <span
              className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs"
              style={{ background: "var(--bg-1)", color: "var(--fg-3)", border: "1px solid var(--line-1)" }}
            >
              👨‍👩‍👧‍👦 {trip.familyProfile.adultCount} adult{trip.familyProfile.adultCount !== 1 ? "s" : ""}
              {childrenAges ? ` · kids ${childrenAges}` : ""}
            </span>
          )}
        </div>
      </div>

      {/* Mobile toggle — hidden at md+ via .neighborhood-mobile-toggle CSS */}
      <div className="neighborhood-mobile-toggle flex gap-2 mb-4" role="group" aria-label="View toggle">
        <button
          aria-pressed={!mapVisible}
          onClick={() => setMapVisible(false)}
          className="rounded-full px-4 py-2 text-sm font-medium transition-colors"
          style={{
            background: !mapVisible ? "var(--accent)" : "transparent",
            color: !mapVisible ? "var(--fg-on-malachite)" : "var(--fg-2)",
            border: `1px solid ${!mapVisible ? "var(--accent)" : "var(--line-2)"}`,
          }}
        >
          List
        </button>
        <button
          aria-pressed={mapVisible}
          onClick={() => setMapVisible(true)}
          className="rounded-full px-4 py-2 text-sm font-medium transition-colors"
          style={{
            background: mapVisible ? "var(--accent)" : "transparent",
            color: mapVisible ? "var(--fg-on-malachite)" : "var(--fg-2)",
            border: `1px solid ${mapVisible ? "var(--accent)" : "var(--line-2)"}`,
          }}
        >
          Map
        </button>
      </div>

      {/* Split-pane: map right / cards left on desktop, stacked on mobile */}
      <div className="neighborhood-layout">
        {/* Map — first in DOM: above cards on mobile (when mapVisible), right column on desktop */}
        <div
          className="neighborhood-map-col"
          style={{ display: mapVisible ? "block" : "none" }}
        >
          <NeighborhoodMap
            neighborhoods={mappedNeighborhoods}
            selectedId={selected}
            hoveredId={hoveredId}
            onSelect={(id) => {
              setSelected(id);
              setMapVisible(false);
              cardRefs.current.get(id)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
            }}
            onHover={setHoveredId}
            lodgingAnchorLat={trip?.lodgingAnchorLat}
            lodgingAnchorLng={trip?.lodgingAnchorLng}
          />
        </div>

        {/* Card list — second in DOM: left column on desktop */}
        <div className="neighborhood-card-col space-y-3" style={{ display: mapVisible ? "none" : "block" }}>
          {mappedNeighborhoods.map((nb, i) => {
            const distanceKm =
              trip?.lodgingAnchorLat != null && trip?.lodgingAnchorLng != null
                ? haversineKm(trip.lodgingAnchorLat, trip.lodgingAnchorLng, nb.centroidLat, nb.centroidLng)
                : null;

            return (
              <div
                key={nb.id}
                ref={(el) => { if (el) cardRefs.current.set(nb.id, el); else cardRefs.current.delete(nb.id); }}
                onMouseEnter={() => setHoveredId(nb.id)}
                onMouseLeave={() => setHoveredId(null)}
              >
              <Card
                style={
                  selected === nb.id
                    ? { borderColor: "var(--accent)", background: "var(--bg-1)" }
                    : hoveredId === nb.id
                      ? { borderColor: "var(--line-2)" }
                      : {}
                }
              >
                <CardBody className="space-y-2">
                  {/* Header row: rank + name + safety badge */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                      style={{ background: "var(--accent)", color: "var(--fg-on-malachite)" }}
                    >
                      {i + 1}
                    </span>
                    <span className="text-base font-semibold" style={{ color: "var(--fg-1)" }}>
                      {nb.name}
                    </span>
                    {nb.safetyPenalty > 0 && (
                      <span
                        className="text-xs rounded-full px-2 py-0.5 font-medium"
                        style={{ background: "var(--warning-bg, #fef3c7)", color: "var(--warning-fg, #92400e)" }}
                      >
                        Near flagged area
                      </span>
                    )}
                  </div>

                  {/* Vibe tagline */}
                  {nb.dayInTheLifePreview.vibeTagline && (
                    <p className="text-sm italic" style={{ color: "var(--fg-3)" }}>
                      "{nb.dayInTheLifePreview.vibeTagline}"
                    </p>
                  )}

                  {/* Highlights */}
                  <ul className="text-sm space-y-0.5 list-disc list-inside" style={{ color: "var(--fg-2)" }}>
                    {nb.dayInTheLifePreview.highlights.map((h, j) => (
                      <li key={j}>{h}</li>
                    ))}
                  </ul>

                  {/* Sample day */}
                  <p className="text-sm" style={{ color: "var(--fg-2)" }}>
                    <span className="font-medium" style={{ color: "var(--fg-1)" }}>Sample day: </span>
                    {nb.dayInTheLifePreview.sampleBundle}
                  </p>

                  {/* Safety note */}
                  {nb.dayInTheLifePreview.safetyNote && (
                    <p className="text-xs" style={{ color: "var(--fg-3)" }}>
                      {nb.dayInTheLifePreview.safetyNote}
                    </p>
                  )}

                  {/* Metadata row: score label + radius + hotel distance */}
                  <div className="flex flex-wrap gap-2 pt-1 text-xs" style={{ color: "var(--fg-3)" }}>
                    <span
                      className="rounded-full px-2 py-0.5 font-medium"
                      style={{ background: "var(--bg-2, var(--bg-1))", border: "1px solid var(--line-1)" }}
                    >
                      {scoreToLabel(nb.familyFriendlinessScore)}
                    </span>
                    <span>{metersToMinutes(nb.walkingRadiusMeters)} activity radius</span>
                    {distanceKm !== null && (
                      <span>{distanceKm} km from your hotel</span>
                    )}
                  </div>

                  {/* Safety flag details — inline popover via <details> */}
                  {nb.safetyPenalty > 0 && (
                    <details className="text-xs" style={{ color: "var(--fg-3)" }}>
                      <summary
                        className="cursor-pointer select-none"
                        style={{ color: "var(--fg-2)" }}
                      >
                        ⓘ About the safety flag
                      </summary>
                      <p className="mt-1 pl-3" style={{ borderLeft: "2px solid var(--line-1)" }}>
                        An area near this neighborhood is flagged in official travel advisories
                        (OSAC, UK FCDO). We've adjusted its ranking down accordingly. It's still
                        a practical choice — the flag is district-level, not block-level.
                      </p>
                    </details>
                  )}
                </CardBody>
                <CardFooter>
                  <Button
                    variant="primary"
                    size="sm"
                    loading={submitting === nb.id}
                    onClick={() => { void handleSelect(nb.id); }}
                  >
                    Explore this area →
                  </Button>
                </CardFooter>
              </Card>
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}
