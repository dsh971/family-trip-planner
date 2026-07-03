"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
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

  return (
    <main className="p-4 pt-6 pb-20 max-w-5xl mx-auto">
      {/* Step progress */}
      <div className="flex items-center gap-1 text-xs mb-4 flex-wrap" style={{ color: "var(--fg-3)" }}>
        <span style={{ color: "var(--accent)" }}>✓ Profile</span>
        <span>→</span>
        <span className="font-semibold" style={{ color: "var(--fg-1)" }}>● Area</span>
        <span>→</span>
        <span>○ Discover</span>
        <span>→</span>
        <span>○ Plan</span>
      </div>

      <div className="mb-4 space-y-2">
        <h1
          className="text-2xl font-bold tracking-tight"
          style={{ fontFamily: "var(--font-display)", color: "var(--fg-1)" }}
        >
          Where do you want to explore?
        </h1>
        <p className="text-sm" style={{ color: "var(--fg-2)" }}>
          You've set your hotel. This step is different — choose the neighborhood we'll
          anchor your days around. Activities and restaurants will cluster here, within
          walking distance.
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

      {/* Mobile toggle — hidden at md+ */}
      <div className="flex gap-2 mb-4 md:hidden" role="group" aria-label="View toggle">
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

      {/* Tablet+: side-by-side grid */}
      <div className="md:grid md:grid-cols-[40%_60%] md:gap-4 md:items-start">
        {/* Card list — hidden on mobile when map is active */}
        <div className={`space-y-3 ${mapVisible ? "hidden md:block" : "block"}`}>
          {neighborhoods.map((nb, i) => {
            const distanceKm =
              trip?.lodgingAnchorLat != null && trip?.lodgingAnchorLng != null
                ? haversineKm(trip.lodgingAnchorLat, trip.lodgingAnchorLng, nb.centroidLat, nb.centroidLng)
                : null;

            return (
              <Card
                key={nb.id}
                style={
                  selected === nb.id
                    ? { borderColor: "var(--accent)", background: "var(--bg-1)" }
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
            );
          })}
        </div>

        {/* Map panel — hidden on mobile when list is active */}
        <div
          className={`${mapVisible ? "block" : "hidden md:block"} rounded-xl overflow-hidden`}
          style={{ height: "70vh", minHeight: "400px", position: "sticky", top: "60px" }}
        >
          <NeighborhoodMap
            neighborhoods={neighborhoods}
            selectedId={selected}
            onSelect={(id) => {
              setSelected(id);
              setMapVisible(false);
            }}
          />
        </div>
      </div>
    </main>
  );
}
