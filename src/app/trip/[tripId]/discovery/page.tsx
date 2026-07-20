"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import {
  Card,
  CardBody,
  Button,
  Badge,
  Alert,
  EmptyState,
} from "@sumiui/react";
import { CheckCircle2 } from "lucide-react";
import StepProgress from "@/components/ui/StepProgress";

const DiscoveryMap = dynamic(
  () => import("@/components/ui/DiscoveryMap"),
  { ssr: false, loading: () => <div style={{ height: "100%" }} /> }
)

interface DiscoveryPlace {
  placeId: string;
  name: string;
  category: "eat" | "visit";
  lat: number;
  lng: number;
  rating: number | null;
  reviewCount: number | null;
  priceLevel: number | null;
  types: string[];
  goodForChildren: boolean | null;
  menuForChildren: boolean | null;
  sources: string[];
  corroborationScore: number;
  distanceFromCentroidMeters: number;
  worthTheDetour: boolean;
  photoReference: string | null;
  description: string | null;
  nearSafetyArea?: boolean;
  rankPosition: number;
}

interface TransitStation {
  placeId: string;
  name: string;
  lat: number;
  lng: number;
}

interface DiscoveryResponse {
  neighborhoodId: number;
  neighborhoodName: string;
  results: DiscoveryPlace[];
  wgAvailable: boolean;
  lodgingLat: number | null;
  lodgingLng: number | null;
  transitStations: TransitStation[];
}

type FilterValue = "all" | "eat" | "visit";

const PILL_FILTERS: { label: string; value: FilterValue }[] = [
  { label: "All", value: "all" },
  { label: "Eat", value: "eat" },
  { label: "Visit", value: "visit" },
];

function corroborationToSignal(score: number): string | null {
  if (score === 0) return null;
  if (score === 1) return "Trending locally";
  return "Highly recommended locally";
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const HOTEL_WALK_THRESHOLD_METERS = 2800; // ~35 min at 80 m/min

function formatWalkingLabel(meters: number, landmark: string): string {
  return `~${Math.max(5, Math.round(meters / 80 / 5) * 5)}-min walking from ${landmark}`;
}

function formatTransitLabel(meters: number, stationName: string): string {
  return `~${Math.max(5, Math.round(meters / 60 / 5) * 5)}-min walk from ${stationName}`;
}

function nearestTransitStation(
  placeLat: number,
  placeLng: number,
  stations: TransitStation[]
): TransitStation | null {
  if (stations.length === 0) return null;
  let nearest = stations[0]!;
  let minDist = haversineMeters(placeLat, placeLng, nearest.lat, nearest.lng);
  for (let i = 1; i < stations.length; i++) {
    const d = haversineMeters(placeLat, placeLng, stations[i]!.lat, stations[i]!.lng);
    if (d < minDist) { minDist = d; nearest = stations[i]!; }
  }
  return nearest;
}

const SKIP_TYPES = new Set([
  "establishment", "point_of_interest", "food", "premise",
  "geocode", "political", "locality", "sublocality",
]);

function formatPlaceTypes(types: string[]): string | null {
  const useful = types.filter((t) => !SKIP_TYPES.has(t));
  if (useful.length === 0) return null;
  return useful.slice(0, 2)
    .map((t) => t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()))
    .join(" · ");
}

function PriceDots({ level }: { level: number | null }) {
  if (level === null) return null;
  return (
    <span className="text-xs" style={{ color: "var(--fg-2)" }}>
      {"$".repeat(level)}
      <span style={{ color: "var(--fg-4, var(--fg-3))" }}>{"$".repeat(Math.max(0, 4 - level))}</span>
    </span>
  );
}

function PlaceCardSkeleton() {
  return (
    <div
      className="animate-pulse rounded-lg"
      style={{ border: "1px solid var(--line-1)", background: "var(--bg-0)" }}
    >
      <div className="p-3 flex gap-3">
        <div className="shrink-0 rounded-lg" style={{ width: "96px", height: "96px", background: "var(--line-2)" }} />
        <div className="flex-1 space-y-2 py-0.5">
          <div className="flex justify-between gap-2">
            <div className="h-4 rounded w-3/4" style={{ background: "var(--line-2)" }} />
            <div className="h-5 w-12 rounded-full shrink-0" style={{ background: "var(--line-2)" }} />
          </div>
          <div className="h-3 rounded w-full" style={{ background: "var(--line-2)" }} />
          <div className="h-3 rounded w-2/3" style={{ background: "var(--line-2)" }} />
          <div className="flex gap-2 pt-1">
            <div className="h-8 flex-1 rounded" style={{ background: "var(--line-2)" }} />
            <div className="h-8 w-14 rounded" style={{ background: "var(--line-2)" }} />
          </div>
        </div>
      </div>
    </div>
  );
}

function PlaceCard({
  place,
  currentDecision,
  onDecide,
  isHighlighted,
  onImageClick,
  distanceLabel,
}: {
  place: DiscoveryPlace;
  currentDecision: "yes" | "no" | null;
  onDecide: (placeId: string, action: "yes" | "no", worthTheDetour: boolean) => void;
  isHighlighted: boolean;
  onImageClick?: (photoReference: string) => void;
  distanceLabel: string;
}) {
  const categoryColor =
    place.category === "eat"
      ? "var(--status-warning-bg, #fef3c7)"
      : "var(--status-info-bg, #dbeafe)";

  const signal = corroborationToSignal(place.corroborationScore);

  if (currentDecision === "no") {
    return (
      <Card style={{ opacity: 0.45 }}>
        <CardBody>
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm truncate" style={{ color: "var(--fg-3)" }}>{place.name}</span>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs" style={{ color: "var(--fg-3)" }}>Skipped</span>
              <button
                onClick={() => onDecide(place.placeId, "yes", place.worthTheDetour)}
                style={{
                  fontSize: "0.75rem",
                  color: "var(--accent)",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: "2px 6px",
                  textDecoration: "underline",
                }}
              >
                Add back
              </button>
            </div>
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card
      style={
        isHighlighted
          ? { borderColor: "var(--accent)", borderWidth: "2px" }
          : currentDecision === "yes"
            ? { borderColor: "var(--accent)" }
            : {}
      }
    >
      <CardBody className="p-3">
        <div className="flex gap-3">
          {/* Thumbnail */}
          <div className="shrink-0" style={{ width: "96px", height: "96px" }}>
            {place.photoReference ? (
              <img
                src={`/api/places/photo?ref=${encodeURIComponent(place.photoReference)}&width=200`}
                alt=""
                loading="lazy"
                style={{ width: "96px", height: "96px", objectFit: "cover", borderRadius: "8px", cursor: "zoom-in", display: "block" }}
                onClick={() => onImageClick?.(place.photoReference!)}
                onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = "none"; }}
              />
            ) : (
              <div
                style={{ width: "96px", height: "96px", borderRadius: "8px", background: categoryColor }}
                aria-hidden="true"
              />
            )}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0 flex flex-col gap-1">
            <div className="flex items-start gap-2">
              <h3 className="text-sm font-semibold flex-1 min-w-0 leading-snug" style={{ color: "var(--fg-1)" }}>
                {place.name}
              </h3>
              <Badge variant={place.category === "eat" ? "warning" : "info"} className="shrink-0">
                {place.category === "eat" ? "Eat" : "Visit"}
              </Badge>
            </div>

            {/* Description: editorial snippet when available, human-readable types as fallback */}
            {(() => {
              const snippet = place.description ?? formatPlaceTypes(place.types);
              return snippet ? (
                <p className="text-xs line-clamp-2 leading-relaxed" style={{ color: "var(--fg-3)" }}>
                  {snippet}
                </p>
              ) : null;
            })()}

            {/* Compact metadata row: rating · price · distance */}
            <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-xs" style={{ color: "var(--fg-2)" }}>
              {place.rating !== null && (
                <span className="flex items-center gap-0.5">
                  <span className="text-yellow-500">★</span>
                  {place.rating.toFixed(1)}
                  {place.reviewCount !== null && (
                    <span style={{ color: "var(--fg-3)" }}>({place.reviewCount.toLocaleString()})</span>
                  )}
                </span>
              )}
              {place.priceLevel !== null && (
                <><span style={{ color: "var(--line-2)" }}>·</span><PriceDots level={place.priceLevel} /></>
              )}
              <span style={{ color: "var(--line-2)" }}>·</span>
              <span style={{ color: "var(--fg-3)" }}>{distanceLabel}</span>
            </div>

            {/* Signal pills */}
            {(signal ?? place.goodForChildren ?? place.worthTheDetour ?? place.nearSafetyArea) && (
              <div className="flex flex-wrap gap-1">
                {signal && <Badge variant="neutral">{signal}</Badge>}
                {place.goodForChildren && <Badge variant="success">Kids ✓</Badge>}
                {place.worthTheDetour && <Badge variant="neutral">Worth detour</Badge>}
                {place.nearSafetyArea && <Badge variant="warning">Safety note</Badge>}
              </div>
            )}

            {currentDecision !== "yes" ? (
              <div className="flex gap-2 pt-1">
                <Button
                  variant="primary"
                  size="sm"
                  className="flex-1"
                  style={{ minHeight: "36px" }}
                  onClick={() => onDecide(place.placeId, "yes", place.worthTheDetour)}
                >
                  Add to list
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  style={{ minHeight: "36px", padding: "0 12px" }}
                  onClick={() => onDecide(place.placeId, "no", place.worthTheDetour)}
                >
                  Skip
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 pt-1">
                <CheckCircle2 size={14} style={{ color: "var(--accent)" }} />
                <p className="text-xs font-medium" style={{ color: "var(--accent)" }}>Added</p>
              </div>
            )}
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

export default function DiscoveryPage() {
  const params = useParams<{ tripId: string }>();
  const tripId = Number(params.tripId);
  const router = useRouter();

  const [state, setState] = useState<"loading" | "done" | "error">("loading");
  const [data, setData] = useState<DiscoveryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<FilterValue>("all");
  const [decisions, setDecisions] = useState<Record<string, "yes" | "no">>({});
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
  const [lightboxRef, setLightboxRef] = useState<string | null>(null);
  const cardRefs = useRef<Map<string, HTMLElement>>(new Map());
  const cardColRef = useRef<HTMLDivElement>(null);
  const scrollHighlightEnabled = useRef(true);

  useEffect(() => {
    if (!lightboxRef) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setLightboxRef(null); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxRef]);

  const runDiscovery = useCallback(async () => {
    setState("loading");
    setError(null);
    try {
      const res = await fetch("/api/discovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tripId }),
      });
      if (!res.ok) {
        const body = await res.json() as { error?: string };
        throw new Error(body.error ?? `Server error ${res.status}`);
      }
      const json = await res.json() as DiscoveryResponse;
      setData(json);
      setState("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setState("error");
    }
  }, [tripId]);

  useEffect(() => {
    void runDiscovery();
  }, [runDiscovery]);

  function handleDecide(placeId: string, action: "yes" | "no", worthTheDetour: boolean) {
    setDecisions((prev) => ({ ...prev, [placeId]: action }));
    if (action !== "yes") return;
    fetch("/api/decisions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tripId, placeId, action: "yes", worthTheDetour }),
    }).catch((e) => console.error("[Decision] Failed to persist", e));
  }

  const addedCount = Object.values(decisions).filter((d) => d === "yes").length;

  const _filtered =
    data?.results.filter((p) => activeFilter === "all" || p.category === activeFilter) ?? [];
  const _seenIds = new Set<string>();
  const visiblePlaces = _filtered.filter((p) => {
    if (_seenIds.has(p.placeId)) return false;
    _seenIds.add(p.placeId);
    return true;
  });
  const countEat = data?.results.filter((p) => p.category === "eat").length ?? 0;
  const countVisit = data?.results.filter((p) => p.category === "visit").length ?? 0;

  // Highlight the map pin for the topmost card visible in the scroll container.
  // The trip layout wraps pages in a fixed div with overflow-y:auto — window never scrolls,
  // so we walk up from the card column to find the actual scrollable ancestor.
  // "Topmost visible" = smallest rect.top that is still >= containerTop in viewport coords.
  // Fires once on mount (for initial selection) and then on every scroll event.
  useEffect(() => {
    if (state !== "done") return;

    function findScrollContainer(el: HTMLElement): HTMLElement | null {
      let parent = el.parentElement;
      while (parent && parent !== document.body) {
        const { overflowY } = window.getComputedStyle(parent);
        if (overflowY === "auto" || overflowY === "scroll") return parent;
        parent = parent.parentElement;
      }
      return null;
    }

    const scrollEl: HTMLElement | Window = cardColRef.current
      ? (findScrollContainer(cardColRef.current) ?? window)
      : window;

    function selectTopCard() {
      if (!scrollHighlightEnabled.current) return;

      const containerEl = scrollEl instanceof Window ? null : scrollEl as HTMLElement;
      const containerTop = containerEl ? containerEl.getBoundingClientRect().top : 0;

      let firstVisibleId: string | null = null;
      let firstVisibleTop = Infinity;
      let lastAboveId: string | null = null;
      let lastAboveTop = -Infinity;

      cardRefs.current.forEach((el, id) => {
        const rect = el.getBoundingClientRect();
        if (rect.top >= containerTop) {
          if (rect.top < firstVisibleTop) { firstVisibleTop = rect.top; firstVisibleId = id; }
        } else {
          if (rect.top > lastAboveTop) { lastAboveTop = rect.top; lastAboveId = id; }
        }
      });

      const winner = firstVisibleId ?? lastAboveId;
      if (winner) setSelectedPlaceId(winner);
    }

    let rafId: number | null = null;
    function onScroll() {
      if (!scrollHighlightEnabled.current) return;
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => { rafId = null; selectTopCard(); });
    }

    const target = scrollEl instanceof Window ? window : scrollEl as HTMLElement;
    target.addEventListener("scroll", onScroll, { passive: true } as AddEventListenerOptions);
    selectTopCard(); // set initial selection without waiting for a scroll event

    return () => {
      target.removeEventListener("scroll", onScroll);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [state]);

  return (
    <main
      className="max-w-5xl mx-auto p-4 space-y-4"
      style={{ paddingBottom: addedCount >= 1 ? "140px" : undefined }}
    >
      <div className="mb-4">
        <StepProgress currentStep="discover" tripId={String(tripId)} />
      </div>

      <div>
        <h1
          className="text-2xl font-bold tracking-tight"
          style={{ fontFamily: "var(--font-display)", color: "var(--fg-1)" }}
        >
          Discover Places
        </h1>
        <p className="text-sm mt-0.5" style={{ color: "var(--fg-2)" }}>
          {data
            ? `Places to eat and visit near ${data.neighborhoodName}, filtered for families`
            : "Finding the best places for your family…"}
        </p>
      </div>

      {state === "loading" && (
        <div className="discovery-layout">
          <div
            className="discovery-map-col animate-pulse"
            style={{ background: "var(--line-2)" }}
          />
          <div className="discovery-card-col space-y-4">
            {[1, 2, 3, 4].map((n) => <PlaceCardSkeleton key={n} />)}
          </div>
        </div>
      )}

      {state === "error" && (
        <Alert variant="danger">
          {error}
          <Button variant="ghost" size="sm" className="ml-2" onClick={() => { void runDiscovery(); }}>
            Try again
          </Button>
        </Alert>
      )}

      {state === "done" && data && (
        <>
          <div className="discovery-layout">
            {/* Map — first in DOM: above cards on mobile, right side on desktop */}
            <div className="discovery-map-col">
              <DiscoveryMap
                places={visiblePlaces.map(p => ({
                  placeId: p.placeId,
                  name: p.name,
                  lat: p.lat,
                  lng: p.lng,
                  category: p.category,
                  worthTheDetour: p.worthTheDetour,
                }))}
                selectedPlaceId={selectedPlaceId}
                onPinClick={(placeId) => {
                  scrollHighlightEnabled.current = false;
                  setSelectedPlaceId(placeId);
                  cardRefs.current.get(placeId)?.scrollIntoView({ behavior: "smooth", block: "center" });
                  setTimeout(() => { scrollHighlightEnabled.current = true; }, 800);
                }}
              />
            </div>

            {/* Card list — second in DOM: below map on mobile, left side on desktop */}
            <div className="discovery-card-col" ref={cardColRef}>
              {/* Pill filters */}
              <div
                className="flex gap-2 overflow-x-auto pb-2 scrollbar-none"
                role="group"
                aria-label="Filter places by category"
              >
                {PILL_FILTERS.map((pill) => {
                  const active = activeFilter === pill.value;
                  const count =
                    pill.value === "all"
                      ? (data?.results.length ?? 0)
                      : pill.value === "eat"
                        ? countEat
                        : countVisit;
                  return (
                    <button
                      key={pill.value}
                      aria-pressed={active}
                      onClick={() => setActiveFilter(pill.value)}
                      className="rounded-full px-4 py-3 text-sm font-medium shrink-0 transition-colors"
                      style={{
                        background: active ? "var(--accent)" : "transparent",
                        color: active ? "var(--fg-on-malachite)" : "var(--fg-2)",
                        border: `1px solid ${active ? "var(--accent)" : "var(--line-2)"}`,
                      }}
                    >
                      {pill.label} ({count})
                    </button>
                  );
                })}
              </div>

              <div className="space-y-4 mt-4">
                {visiblePlaces.length === 0 ? (
                  <EmptyState
                    title="No places yet"
                    description={
                      activeFilter === "eat"
                        ? "No restaurants found here — try the All filter."
                        : activeFilter === "visit"
                          ? "No activities found here — try the All filter."
                          : "Nothing found in this category."
                    }
                  />
                ) : (
                  visiblePlaces.map((place) => (
                    <div
                      key={place.placeId}
                      data-place-id={place.placeId}
                      ref={(el) => {
                        if (el) cardRefs.current.set(place.placeId, el);
                        else cardRefs.current.delete(place.placeId);
                      }}
                    >
                      <PlaceCard
                        place={place}
                        currentDecision={decisions[place.placeId] ?? null}
                        onDecide={handleDecide}
                        isHighlighted={place.placeId === selectedPlaceId}
                        onImageClick={setLightboxRef}
                        distanceLabel={(() => {
                          if (data.lodgingLat !== null && data.lodgingLng !== null) {
                            const distFromHotel = haversineMeters(data.lodgingLat, data.lodgingLng, place.lat, place.lng);
                            if (distFromHotel <= HOTEL_WALK_THRESHOLD_METERS) {
                              return formatWalkingLabel(distFromHotel, "hotel");
                            }
                            const nearest = nearestTransitStation(place.lat, place.lng, data.transitStations);
                            if (nearest) {
                              return formatTransitLabel(
                                haversineMeters(place.lat, place.lng, nearest.lat, nearest.lng),
                                nearest.name
                              );
                            }
                            return formatWalkingLabel(distFromHotel, "hotel");
                          }
                          const nearestNoHotel = nearestTransitStation(place.lat, place.lng, data.transitStations);
                          if (nearestNoHotel) {
                            return formatTransitLabel(
                              haversineMeters(place.lat, place.lng, nearestNoHotel.lat, nearestNoHotel.lng),
                              nearestNoHotel.name
                            );
                          }
                          return `In ${data.neighborhoodName}`;
                        })()}
                      />
                    </div>
                  ))
                )}
              </div>

              <button
                onClick={() => { void runDiscovery(); }}
                style={{
                  fontSize: "0.8rem",
                  color: "var(--fg-3)",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  textDecoration: "underline",
                  padding: "4px 0",
                  display: "block",
                  width: "100%",
                  textAlign: "center",
                  marginTop: "16px",
                }}
              >
                Search again
              </button>
            </div>
          </div>
        </>
      )}

      {addedCount >= 1 && (
        <div
          style={{
            position: "fixed",
            bottom: "64px",
            left: 0,
            right: 0,
            background: "var(--accent, #2d9b6f)",
            color: "var(--fg-on-malachite, #fff)",
            padding: "12px 16px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            zIndex: 40,
            boxShadow: "0 -2px 8px rgba(0,0,0,0.12)",
          }}
        >
          <span style={{ fontSize: "0.875rem", fontWeight: 600 }}>
            {addedCount} {addedCount === 1 ? "place" : "places"} added
          </span>
          <button
            onClick={() => router.push(`/trip/${tripId}/itinerary`)}
            style={{
              background: "rgba(255,255,255,0.2)",
              border: "1px solid rgba(255,255,255,0.4)",
              borderRadius: "6px",
              padding: "6px 14px",
              color: "inherit",
              fontWeight: 600,
              fontSize: "0.875rem",
              cursor: "pointer",
            }}
          >
            Build my schedule →
          </button>
        </div>
      )}

      {lightboxRef && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Photo fullscreen view"
          onClick={() => setLightboxRef(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.88)",
            zIndex: 200,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <button
            aria-label="Close"
            onClick={() => setLightboxRef(null)}
            style={{
              position: "absolute",
              top: "16px",
              right: "16px",
              background: "rgba(255,255,255,0.15)",
              border: "none",
              borderRadius: "50%",
              width: "40px",
              height: "40px",
              color: "white",
              fontSize: "1.25rem",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              lineHeight: 1,
            }}
          >
            ✕
          </button>
          <img
            src={`/api/places/photo?ref=${encodeURIComponent(lightboxRef)}&width=1200`}
            alt="Place photo"
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: "90vw",
              maxHeight: "90vh",
              objectFit: "contain",
              borderRadius: "8px",
              boxShadow: "0 8px 48px rgba(0,0,0,0.6)",
            }}
          />
        </div>
      )}
    </main>
  );
}
