"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import {
  Card,
  CardBody,
  Button,
  Badge,
  Skeleton,
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

interface DiscoveryResponse {
  neighborhoodId: number;
  neighborhoodName: string;
  results: DiscoveryPlace[];
  wgAvailable: boolean;
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

function metersToMinutes(meters: number): string {
  return `~${Math.max(5, Math.round(meters / 80 / 5) * 5)}-min walk`;
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

function PlaceCard({
  place,
  currentDecision,
  onDecide,
  isHighlighted,
}: {
  place: DiscoveryPlace;
  currentDecision: "yes" | "no" | null;
  onDecide: (placeId: string, action: "yes" | "no", worthTheDetour: boolean) => void;
  isHighlighted: boolean;
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
      <div
        className="h-1 w-full rounded-t-lg"
        style={{ background: categoryColor }}
        aria-hidden="true"
      />
      <CardBody className="space-y-2 pt-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold truncate" style={{ color: "var(--fg-1)" }}>
              {place.name}
            </h3>
            <p className="text-xs mt-0.5 truncate" style={{ color: "var(--fg-3)" }}>
              {place.types.slice(0, 2).join(" · ")}
            </p>
          </div>
          <Badge variant={place.category === "eat" ? "warning" : "info"}>
            {place.category === "eat" ? "Eat" : "Visit"}
          </Badge>
        </div>

        <div className="flex items-center gap-3 text-xs" style={{ color: "var(--fg-2)" }}>
          {place.rating !== null && (
            <span className="flex items-center gap-0.5">
              <span className="text-yellow-500">★</span>
              {place.rating.toFixed(1)}
              {place.reviewCount !== null && (
                <span className="ml-0.5" style={{ color: "var(--fg-3)" }}>
                  ({place.reviewCount.toLocaleString()})
                </span>
              )}
            </span>
          )}
          <PriceDots level={place.priceLevel} />
          <span style={{ color: "var(--fg-3)" }}>{metersToMinutes(place.distanceFromCentroidMeters)}</span>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {signal && (
            <Badge variant="neutral">{signal}</Badge>
          )}
          {place.goodForChildren && <Badge variant="success">Kids ✓</Badge>}
          {place.worthTheDetour && <Badge variant="neutral">Worth detour</Badge>}
          {place.nearSafetyArea && <Badge variant="warning">Safety note</Badge>}
        </div>

        {currentDecision !== "yes" ? (
          <div className="flex gap-2 pt-1">
            <Button
              variant="primary"
              size="sm"
              className="flex-1"
              onClick={() => onDecide(place.placeId, "yes", place.worthTheDetour)}
            >
              Add to list
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="flex-1"
              onClick={() => onDecide(place.placeId, "no", place.worthTheDetour)}
            >
              Skip
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 pt-1">
            <CheckCircle2 size={14} style={{ color: "var(--accent)" }} />
            <p className="text-xs font-medium" style={{ color: "var(--accent)" }}>
              Added to your list
            </p>
          </div>
        )}
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
  const [mapExpanded, setMapExpanded] = useState(true);
  const cardRefs = useRef<Map<string, HTMLElement>>(new Map());

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

  const visiblePlaces =
    data?.results.filter((p) => activeFilter === "all" || p.category === activeFilter) ?? [];
  const countEat = data?.results.filter((p) => p.category === "eat").length ?? 0;
  const countVisit = data?.results.filter((p) => p.category === "visit").length ?? 0;

  return (
    <main
      className="max-w-5xl mx-auto p-4 space-y-4"
      style={{ paddingBottom: addedCount >= 1 ? "140px" : undefined }}
    >
      <div className="mb-4">
        <StepProgress currentStep="discover" />
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
        <div className="space-y-3">
          {[1, 2, 3].map((n) => <Skeleton key={n} height="8rem" />)}
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
          <div className="md:grid md:grid-cols-[40%_60%] md:gap-4 md:items-start">
            {/* Left: card list */}
            <div>
              {/* Mobile map toggle button */}
              <button
                className="md:hidden flex items-center gap-1 text-sm mb-3"
                style={{ minHeight: "44px" }}
                onClick={() => setMapExpanded(prev => !prev)}
                aria-expanded={mapExpanded}
                aria-label="Toggle map"
              >
                {mapExpanded ? "▲ Hide map" : "▼ Show map"}
              </button>

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
                    description="Nothing found in this category."
                  />
                ) : (
                  visiblePlaces.map((place) => (
                    <div
                      key={place.placeId}
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

            {/* Right: map panel */}
            <div
              className={`${mapExpanded ? "block" : "hidden"} md:block`}
              style={{ height: "70vh", minHeight: "400px", position: "sticky", top: "60px" }}
            >
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
                  setSelectedPlaceId(placeId);
                  cardRefs.current.get(placeId)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
                }}
              />
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
    </main>
  );
}
