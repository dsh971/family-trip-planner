"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Button,
  Alert,
  Skeleton,
  EmptyState,
} from "@sumiui/react";
import { Building2, Users } from "lucide-react";
import { useResearchStream } from "@/components/ui/useResearchStream";
import ResearchHighlight from "@/components/ui/ResearchHighlight";
import EditorialBackdrop from "@/components/ui/EditorialBackdrop";
import { getPlaceGradient } from "@/lib/placeGradient";
import type { Neighborhood } from "@/db/schema";

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

interface MappedNeighborhood extends RankedNeighborhood {
  rankPosition: number;
}

interface TripDetail {
  id: number;
  destinationId: number;
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

// Manual re-research trigger cooldown (U7): on top of the route's own
// per-IP rate limit, a short client-side cooldown keeps "low-visibility"
// from being the only thing standing between the button and repeated-click
// abuse.
const MANUAL_TRIGGER_COOLDOWN_MS = 5000;

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

// Dimension-matched placeholder for one NeighborhoodCard while its data is
// still streaming in — same model as discovery/page.tsx's PlaceCardSkeleton.
function NeighborhoodCardSkeleton() {
  return (
    <div
      className="animate-pulse rounded-lg p-4 space-y-2"
      style={{ border: "1px solid var(--line-1)", background: "var(--bg-1)" }}
    >
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded-full shrink-0" style={{ background: "var(--bg-3)" }} />
        <div className="h-4 rounded w-1/3" style={{ background: "var(--bg-3)" }} />
      </div>
      <div className="h-3 rounded w-2/3" style={{ background: "var(--bg-2)" }} />
      <div className="h-3 rounded w-full" style={{ background: "var(--bg-2)" }} />
      <div className="h-3 rounded w-5/6" style={{ background: "var(--bg-2)" }} />
      <div className="h-8 rounded w-1/3" style={{ background: "var(--bg-3)" }} />
    </div>
  );
}

function NeighborhoodCard({
  nb,
  index,
  selected,
  hovered,
  submitting,
  distanceKm,
  onSelect,
  onHover,
  onLeave,
  cardRef,
}: {
  nb: MappedNeighborhood;
  index: number;
  selected: boolean;
  hovered: boolean;
  submitting: boolean;
  distanceKm: number | null;
  onSelect: () => void;
  onHover: () => void;
  onLeave: () => void;
  cardRef: (el: HTMLElement | null) => void;
}) {
  return (
    <div ref={cardRef} onMouseEnter={onHover} onMouseLeave={onLeave}>
      {/* Plain div, not Sumi's Card — matching Web-Neighborhoods.dc.html's
          borderless row (no default border/shadow), unlike Trip setup's
          cards this one still carries real state (selected/hovered), so
          that conditional styling moved here from Card's old style prop
          rather than getting dropped along with the border. */}
      <div
        className="rounded-xl transition-colors"
        style={
          selected
            ? { border: "1px solid var(--accent)", background: "var(--bg-1)" }
            : hovered
              ? { border: "1px solid var(--line-2)" }
              : { border: "1px solid transparent" }
        }
      >
        <div className="space-y-2 p-4">
          {/* Header row: thumbnail + rank + name + safety badge. Neighborhoods
              have no Google Places photo of their own (unlike individual
              places), so this is always the deterministic gradient fallback —
              matching by nb.name (there's no per-neighborhood placeId). */}
          <div className="flex items-center gap-2 flex-wrap">
            <div
              className="shrink-0"
              style={{
                width: "44px",
                height: "44px",
                borderRadius: "8px",
                background: getPlaceGradient(nb.name),
              }}
              aria-hidden="true"
            />
            <span
              className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
              style={{ background: "var(--accent)", color: "var(--fg-on-malachite)" }}
            >
              {index + 1}
            </span>
            <span
              className="text-base font-semibold"
              style={{ fontFamily: "var(--font-display)", color: "var(--fg-1)" }}
            >
              {nb.name}
            </span>
            {nb.safetyPenalty > 0 && (
              <span
                className="text-xs rounded-full px-2 py-0.5 font-medium"
                style={{ background: "var(--status-warning-bg)", color: "var(--status-warning)" }}
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
              style={{ background: "var(--bg-2)", border: "1px solid var(--line-1)" }}
            >
              {scoreToLabel(nb.familyFriendlinessScore)}
            </span>
            <span style={{ fontFamily: "var(--font-mono)" }}>
              {metersToMinutes(nb.walkingRadiusMeters)} activity radius
            </span>
            {distanceKm !== null && (
              <span style={{ fontFamily: "var(--font-mono)" }}>{distanceKm} km from your hotel</span>
            )}
          </div>

          {/* Safety flag details — inline popover via <details> */}
          {nb.safetyPenalty > 0 && (
            <details className="text-xs" style={{ color: "var(--fg-3)" }}>
              <summary className="cursor-pointer select-none" style={{ color: "var(--fg-2)" }}>
                ⓘ About the safety flag
              </summary>
              <p className="mt-1 pl-3" style={{ borderLeft: "2px solid var(--line-1)" }}>
                An area near this neighborhood is flagged in official travel advisories
                (OSAC, UK FCDO). We've adjusted its ranking down accordingly. It's still
                a practical choice — the flag is district-level, not block-level.
              </p>
            </details>
          )}
          <div className="pt-2">
            <Button variant="primary" size="sm" className="rounded-xl" loading={submitting} onClick={onSelect}>
              Explore this area →
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
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
  const [forceAttempt, setForceAttempt] = useState(0);
  const [cooldown, setCooldown] = useState(false);
  const cardRefs = useRef<Map<number, HTMLElement>>(new Map());

  useEffect(() => {
    void (async () => {
      // Trip must be fetched first — its destinationId is the real destination to
      // query neighborhoods for (plan 2026-08-20-011 U2 removed the hardcoded
      // destinationId=1 query param). Unlike before, a failed trip fetch is now
      // fatal: without a real destinationId there's no correct destination to show
      // neighborhoods for.
      const tripRes = await fetch(`/api/trips/${tripId}`);
      if (!tripRes.ok) {
        setError("Failed to load trip");
        setLoading(false);
        return;
      }
      const tripData = await tripRes.json() as TripDetail;
      setTrip(tripData);
      setLoading(false);
    })();
  }, [tripId]);

  // U7 (plan 2026-08-20-011): SSE research stream for this destination's
  // neighborhood-discovery pass — replaces the old single fetch-on-mount
  // with progressive reveal, a distinct "researching" vs "complete" (cached)
  // state, and a manual re-research trigger (force=true, below).
  const researchUrl = trip
    ? `/api/destinations/${trip.destinationId}/research${
        forceAttempt > 0 ? `?force=true&attempt=${forceAttempt}` : ""
      }`
    : null;
  const research = useResearchStream<{ text?: string; neighborhood?: Neighborhood }>(researchUrl, {
    itemEventNames: ["highlight", "neighborhood"],
  });

  // Once the run reaches a terminal, non-error status, fetch the final
  // ranked list (GET /api/neighborhoods — a cheap local DB read + ranking
  // computation, not another external research pass) rather than deriving
  // final order from raw stream items, so safety-penalty ranking stays
  // centralized in one place. Re-runs whenever status flips back to
  // "complete"/"partial" (e.g. after a manual re-research run finishes).
  useEffect(() => {
    if (!trip) return;
    if (research.status !== "complete" && research.status !== "partial") return;
    let cancelled = false;
    void (async () => {
      const res = await fetch(`/api/neighborhoods?destinationId=${trip.destinationId}`);
      if (!res.ok || cancelled) return;
      const data = (await res.json()) as RankedNeighborhood[];
      if (!cancelled) setNeighborhoods(data);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [research.status, trip?.destinationId]);

  function handleForceRerun() {
    if (research.status === "researching" || cooldown) return;
    setNeighborhoods([]); // show the researching/progressive state again, not stale cards
    setForceAttempt((n) => n + 1);
    setCooldown(true);
    setTimeout(() => setCooldown(false), MANUAL_TRIGGER_COOLDOWN_MS);
  }

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

  const childrenAges = trip ? formatChildrenAges(trip.familyProfile.children) : null;
  const nights = trip ? tripNights(trip.startDate, trip.endDate) : 0;
  const mappedNeighborhoods: MappedNeighborhood[] = neighborhoods.map((nb, i) => ({ ...nb, rankPosition: i + 1 }));

  // Raw stream items, in arrival order, rendered as real (already-persisted)
  // cards during the "researching" wait state — synthesized ranking fields
  // (rankingScore/safetyPenalty aren't known until the final ranked fetch
  // above resolves) so the progressive view can reuse the exact same
  // NeighborhoodCard used by the final render, rather than a separate
  // lower-fidelity preview component.
  const highlightItem = research.items.find((i) => i.type === "highlight");
  const highlightText = highlightItem?.data.text ?? null;
  const rawNeighborhoods: MappedNeighborhood[] = research.items
    .filter((i) => i.type === "neighborhood" && i.data.neighborhood)
    .map((i, idx) => {
      const n = i.data.neighborhood as Neighborhood;
      return {
        id: n.id,
        name: n.name,
        familyFriendlinessScore: n.familyFriendlinessScore,
        rankingScore: n.familyFriendlinessScore,
        safetyPenalty: 0,
        dayInTheLifePreview: n.dayInTheLifePreview,
        walkingRadiusMeters: n.walkingRadiusMeters,
        centroidLat: n.centroidLat,
        centroidLng: n.centroidLng,
        rankPosition: idx + 1,
      };
    });

  const hasFinal = mappedNeighborhoods.length > 0;
  const isResearching = research.status === "researching" || research.status === "not_started";
  const isErrored = research.status === "error";

  // Prefer the final ranked list once it's fetched; until then, fall back
  // to raw stream items so there's never a gap between the SSE run settling
  // (status "complete"/"partial") and the subsequent ranked-list fetch
  // resolving where the page would otherwise show neither a skeleton nor
  // real content. For the cached/fresh case (AE2) this raw fallback IS the
  // final data in substance (same persisted rows, just pre-ranking), so the
  // page renders real content immediately with no skeleton flash; for a
  // brand-new destination (AE1) it's what grows progressively while
  // status stays "researching".
  const displayList = hasFinal ? mappedNeighborhoods : rawNeighborhoods;
  const showTrailingSkeletons = isResearching && !hasFinal;

  const manualTriggerDisabled = research.status === "researching" || cooldown;

  return (
    <main className="neighborhood-shell p-4 pt-6 pb-20 max-w-5xl mx-auto" style={{ position: "relative" }}>
      <EditorialBackdrop variant="light" />
      <div className="mb-4 space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          {/* Design-fidelity fix (2026-08-23): explicit style, not classNames
              — Sumi's own base CSS sets h1's font-size/weight/tracking/
              line-height/margin unconditionally and UNLAYERED, which always
              beats layered utility classes (CSS Cascade Layers spec)
              regardless of specificity. text-2xl/font-bold/tracking-tight
              silently did nothing here; verified via computed styles this
              was rendering at Sumi's default ~48px, not the intended 24px. */}
          <h1
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "1.5rem",
              fontWeight: 700,
              letterSpacing: "-0.025em",
              lineHeight: 1.2,
              color: "var(--fg-1)",
              margin: 0,
            }}
          >
            Where do you want to explore?
          </h1>
          {/* Manual re-research trigger (U7): small, low-visibility, next to the
              header. Disabled while a run is already in progress, plus a short
              client-side cooldown after use on top of the route's per-IP rate limit. */}
          <button
            onClick={handleForceRerun}
            disabled={manualTriggerDisabled}
            title="Re-check for updated neighborhood data"
            style={{
              fontSize: "0.7rem",
              color: "var(--fg-3)",
              background: "none",
              border: "none",
              textDecoration: "underline",
              cursor: manualTriggerDisabled ? "not-allowed" : "pointer",
              opacity: manualTriggerDisabled ? 0.5 : 1,
              padding: 0,
            }}
          >
            ↻ Refresh neighborhood data
          </button>
        </div>
        <p className="text-sm" style={{ color: "var(--fg-2)" }}>
          Choose the neighborhood you'll anchor your {formatTripDuration(nights)} around — activities
          and restaurants will cluster here, within walking distance.
        </p>

        {/* Context chips */}
        <div className="flex flex-wrap gap-2 mt-2">
          {trip?.hotelName && (
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs"
              style={{ background: "var(--bg-1)", color: "var(--fg-3)", border: "1px solid var(--line-1)" }}
            >
              <Building2 size={12} aria-hidden="true" />
              Staying at: {trip.hotelName}
            </span>
          )}
          {trip && (
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs"
              style={{ background: "var(--bg-1)", color: "var(--fg-3)", border: "1px solid var(--line-1)" }}
            >
              <Users size={12} aria-hidden="true" />
              <span style={{ fontFamily: "var(--font-mono)" }}>{trip.familyProfile.adultCount}</span>
              &nbsp;adult{trip.familyProfile.adultCount !== 1 ? "s" : ""}
              {childrenAges ? ` · kids ${childrenAges}` : ""}
            </span>
          )}
        </div>
      </div>

      {isErrored && (
        <Alert variant="danger">
          {research.errorMessage ?? "Couldn't load neighborhoods."}
          <Button variant="ghost" size="sm" className="ml-2" onClick={() => research.retry()}>
            Try again
          </Button>
        </Alert>
      )}

      {!isErrored && displayList.length === 0 && (
        isResearching ? (
          // Progressive-reveal wait state (R6, R9, AE1): a highlight blurb plus
          // a couple of skeletons signalling neighborhoods are on the way.
          // aria-live="polite" announces each new arrival to screen readers.
          <div aria-live="polite" className="space-y-3">
            {highlightText && <ResearchHighlight text={highlightText} />}
            <NeighborhoodCardSkeleton />
            <NeighborhoodCardSkeleton />
          </div>
        ) : (
          <EmptyState title="No neighborhoods found" description="No neighborhood data is available for this destination." />
        )
      )}

      {!isErrored && displayList.length > 0 && (
        <>
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
            <div className="neighborhood-map-col" style={{ display: mapVisible ? "block" : "none" }}>
              <NeighborhoodMap
                neighborhoods={displayList}
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
            <div
              className="neighborhood-card-col space-y-3"
              style={{ display: mapVisible ? "none" : "block" }}
              aria-live="polite"
            >
              {isResearching && highlightText && <ResearchHighlight text={highlightText} />}
              {displayList.map((nb, i) => {
                const distanceKm =
                  trip?.lodgingAnchorLat != null && trip?.lodgingAnchorLng != null
                    ? haversineKm(trip.lodgingAnchorLat, trip.lodgingAnchorLng, nb.centroidLat, nb.centroidLng)
                    : null;

                return (
                  <NeighborhoodCard
                    key={nb.id}
                    nb={nb}
                    index={i}
                    selected={selected === nb.id}
                    hovered={hoveredId === nb.id}
                    submitting={submitting === nb.id}
                    distanceKm={distanceKm}
                    onSelect={() => { void handleSelect(nb.id); }}
                    onHover={() => setHoveredId(nb.id)}
                    onLeave={() => setHoveredId(null)}
                    cardRef={(el) => { if (el) cardRefs.current.set(nb.id, el); else cardRefs.current.delete(nb.id); }}
                  />
                );
              })}
              {showTrailingSkeletons && <NeighborhoodCardSkeleton />}
            </div>
          </div>
        </>
      )}
    </main>
  );
}
