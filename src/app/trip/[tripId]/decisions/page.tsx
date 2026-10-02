"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  Button,
  Badge,
  Skeleton,
  Alert,
  EmptyState,
} from "@sumiui/react";
import { Utensils, Landmark, ExternalLink } from "lucide-react";
import EditorialBackdrop from "@/components/ui/EditorialBackdrop";
import PlacePeek from "@/components/ui/PlacePeek";
import { getPlaceGradient } from "@/lib/placeGradient";

// Reused directly from Discovery (U6, plan 2026-08-23-002) rather than
// extracted into a smaller shared base — Decisions' needs (static pins, no
// click-to-select) are already satisfied by DiscoveryMap's existing prop
// shape via no-op/null values, so a new abstraction wasn't warranted.
const DiscoveryMap = dynamic(
  () => import("@/components/ui/DiscoveryMap"),
  { ssr: false, loading: () => <div style={{ height: "100%" }} /> }
);

interface DecisionRow {
  id: number;
  placeId: number;
  category: string;
  decision: string;
  worthTheDetour: boolean;
  updatedAt: string;
  placeName: string | null;
  placeGoogleId: string | null;
  lat: number | null;
  lng: number | null;
  rating: number | null;
  priceLevel: number | null;
  photoReference: string | null;
  description: string | null;
}

interface DecisionsResponse {
  decisions: DecisionRow[];
}

type FilterValue = "eat" | "visit";

const PILL_FILTERS: { label: string; value: FilterValue }[] = [
  { label: "Eat", value: "eat" },
  { label: "Visit", value: "visit" },
];

export default function DecisionsPage() {
  const params = useParams<{ tripId: string }>();
  const tripId = Number(params.tripId);

  const [decisions, setDecisions] = useState<DecisionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<FilterValue>("eat");
  const [openPeekId, setOpenPeekId] = useState<number | null>(null);

  const loadDecisions = useCallback(async () => {
    try {
      const res = await fetch(`/api/decisions?tripId=${tripId}`);
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const json = await res.json() as DecisionsResponse;
      setDecisions(json.decisions.filter((d) => d.decision === "yes"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [tripId]);

  useEffect(() => {
    void loadDecisions();
  }, [loadDecisions]);

  async function removeDecision(googlePlaceId: string) {
    const optimistic = decisions.filter((d) => d.placeGoogleId !== googlePlaceId);
    setDecisions(optimistic);
    try {
      const res = await fetch(`/api/decisions?tripId=${tripId}&placeId=${encodeURIComponent(googlePlaceId)}`, {
        method: "DELETE",
      });
      if (!res.ok) await loadDecisions();
    } catch {
      await loadDecisions();
    }
  }

  const countEat = decisions.filter((d) => d.category === "eat").length;
  const countVisit = decisions.filter((d) => d.category === "visit").length;
  const filtered = decisions.filter((d) => d.category === activeFilter);

  // Desktop split-pane map (U6): pins for EVERY currently-saved place,
  // regardless of the Eat/Visit pill filter — the map isn't a filtered view
  // the way the list is (plan's Approach section). Places without
  // coordinates are dropped since DiscoveryMap requires numeric lat/lng.
  const mapPlaces = decisions
    .filter((d): d is DecisionRow & { lat: number; lng: number } => d.lat !== null && d.lng !== null)
    .map((d) => ({
      placeId: d.placeGoogleId ?? String(d.id),
      name: d.placeName ?? "—",
      lat: d.lat,
      lng: d.lng,
      category: (d.category === "eat" ? "eat" : "visit") as "eat" | "visit",
      worthTheDetour: d.worthTheDetour,
    }));

  return (
    <main className="decisions-shell max-w-lg mx-auto p-4 space-y-4" style={{ position: "relative" }}>
      <EditorialBackdrop variant="light" />
      <div>
        {/* Design-fidelity fix (2026-08-23): see neighborhoods/page.tsx's
            identical h1 comment — Sumi's unlayered h1 base rule always beats
            the text-2xl/font-bold/tracking-tight utility classes. */}
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
          Your picks
        </h1>
        <p className="text-sm mt-0.5" style={{ color: "var(--fg-2)" }}>
          Adjust your list here, then build your schedule.
        </p>
      </div>

      {/* Stat chips — separate sibling so space-y-4 creates gaps above and below */}
      {decisions.length > 0 && (
        <div className="flex gap-2">
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm"
            style={{ background: "var(--bg-2)", color: "var(--fg-2)" }}
          >
            <Utensils size={13} aria-hidden="true" />
            <span style={{ fontFamily: "var(--font-mono)" }}>{countEat}</span>
            &nbsp;restaurant{countEat !== 1 ? "s" : ""}
          </span>
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm"
            style={{ background: "var(--bg-2)", color: "var(--fg-2)" }}
          >
            <Landmark size={13} aria-hidden="true" />
            <span style={{ fontFamily: "var(--font-mono)" }}>{countVisit}</span>
            &nbsp;{countVisit !== 1 ? "activities" : "activity"}
          </span>
        </div>
      )}

      {error && <Alert variant="danger">{error}</Alert>}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((n) => <Skeleton key={n} height="5rem" />)}
        </div>
      ) : (
        <div className="decisions-layout">
          {/* List — first in DOM: the only thing rendered on mobile (map is
              CSS-hidden below 1024px), ~460px left column on desktop. */}
          <div className="decisions-list-col space-y-4 pb-8">
            {/* Pill filters */}
            <div
              className="flex gap-2 overflow-x-auto pb-2 scrollbar-none"
              role="group"
              aria-label="Filter by category"
            >
              {PILL_FILTERS.map((pill) => {
                const active = activeFilter === pill.value;
                const count = pill.value === "eat" ? countEat : countVisit;
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

            <div className="space-y-3">
              {filtered.length === 0 ? (
                <EmptyState
                  title={`No ${activeFilter === "eat" ? "restaurants" : "activities"} yet`}
                  description="Go to Discovery to add places."
                />
              ) : (
                <>
                  {filtered.map((d) => (
                    // Plain div with an explicit light card style, not Sumi's
                    // Card — unlike Neighborhoods/Discovery, Web-Decisions.dc.html
                    // keeps a real (lighter) bordered card here, so this one
                    // isn't stripped down to borderless the way those were.
                    <div
                      key={d.id}
                      className="flex items-start justify-between gap-3 p-3 rounded-xl"
                      style={{ background: "var(--bg-1)", border: "1px solid var(--line-1)" }}
                    >
                        {/* Thumbnail — gradient + category icon render unconditionally
                            (docs/plans/2026-09-12-001-fix-design-audit-bugs-plan.md
                            U1, U6) so a failed or absent photo degrades to a
                            category-labeled block instead of an empty slot or a
                            flat abstract gradient. */}
                        <div
                          className="shrink-0"
                          style={{
                            width: "52px",
                            height: "52px",
                            borderRadius: "8px",
                            background: getPlaceGradient(d.placeGoogleId ?? d.placeName),
                            overflow: "hidden",
                            position: "relative",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                          aria-hidden="true"
                        >
                          {d.category === "eat" ? (
                            <Utensils size={16} style={{ color: "rgba(255,255,255,0.85)" }} />
                          ) : (
                            <Landmark size={16} style={{ color: "rgba(255,255,255,0.85)" }} />
                          )}
                          {d.photoReference && (
                            <img
                              src={`/api/places/photo?ref=${encodeURIComponent(d.photoReference)}&width=104`}
                              alt=""
                              loading="lazy"
                              style={{ position: "absolute", inset: 0, width: "52px", height: "52px", objectFit: "cover", display: "block" }}
                              onError={(e) => { e.currentTarget.style.display = "none"; }}
                            />
                          )}
                        </div>
                        <div className="flex-1 min-w-0 space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant={d.category === "eat" ? "warning" : "info"}>
                              {d.category === "eat" ? "Eat" : "Visit"}
                            </Badge>
                            {d.worthTheDetour && <Badge variant="neutral">Detour</Badge>}
                          </div>
                          <p
                            className="font-semibold text-sm truncate"
                            style={{ fontFamily: "var(--font-display)", color: "var(--fg-1)" }}
                          >
                            {d.placeName ?? "—"}
                          </p>
                          <div className="flex items-center gap-2">
                            {d.rating !== null && (
                              <span
                                className="text-xs flex items-center gap-0.5"
                                style={{ color: "var(--fg-2)", fontFamily: "var(--font-mono)" }}
                              >
                                <span className="text-yellow-500">★</span>
                                {d.rating.toFixed(1)}
                              </span>
                            )}
                            {d.priceLevel !== null && (
                              <span
                                className="text-xs"
                                style={{ color: "var(--fg-2)", fontFamily: "var(--font-mono)" }}
                              >
                                {"$".repeat(d.priceLevel)}
                              </span>
                            )}
                          </div>
                          {/* In-app peek preview (U9, plan 2026-09-12-001),
                              replacing the plain external link U7 shipped —
                              see PlacePeek for why the content is what it is. */}
                          {d.placeGoogleId && (
                            <div style={{ position: "relative" }}>
                              <button
                                type="button"
                                onClick={() => setOpenPeekId((v) => (v === d.id ? null : d.id))}
                                className="inline-flex items-center gap-1 text-xs w-fit"
                                style={{ color: "var(--fg-3)", background: "none", border: "none", padding: 0, cursor: "pointer", font: "inherit" }}
                              >
                                <ExternalLink size={11} aria-hidden="true" />
                                View photos
                              </button>
                              {openPeekId === d.id && (
                                <PlacePeek
                                  name={d.placeName ?? "—"}
                                  category={d.category === "eat" ? "eat" : "visit"}
                                  priceLevel={d.priceLevel}
                                  description={d.description}
                                  placeGoogleId={d.placeGoogleId}
                                  onClose={() => setOpenPeekId(null)}
                                />
                              )}
                            </div>
                          )}
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Remove ${d.placeName ?? "place"}`}
                          onClick={() => d.placeGoogleId && void removeDecision(d.placeGoogleId)}
                        >
                          ✕
                        </Button>
                    </div>
                  ))}
                  <p
                    className="text-xs text-center pt-2"
                    style={{ color: "var(--fg-3)", borderTop: "1px solid var(--line-1)" }}
                  >
                    <span style={{ fontFamily: "var(--font-mono)" }}>{filtered.length}</span>{" "}
                    {activeFilter === "eat"
                      ? `restaurant${filtered.length !== 1 ? "s" : ""}`
                      : filtered.length !== 1 ? "activities" : "activity"}{" "}
                    selected
                  </p>
                </>
              )}
            </div>

            {/* Empty state back-link */}
            {decisions.length === 0 && !loading && (
              <div style={{ textAlign: "center", paddingTop: "8px" }}>
                <Link
                  href={`/trip/${params.tripId}/discovery`}
                  style={{ fontSize: "0.875rem", color: "var(--accent)" }}
                >
                  ← Back to discovering
                </Link>
              </div>
            )}

            {/* Build schedule CTA — sticky below 1024px (see globals.css's
                .decisions-cta-sticky) so it's never clipped by the fixed
                BottomNav on first paint, static in flow at desktop. */}
            {decisions.length > 0 && (
              <div className="decisions-cta-sticky">
                <Button variant="primary" size="lg" className="w-full rounded-xl" asChild>
                  <Link href={`/trip/${params.tripId}/itinerary`}>
                    Build my schedule →
                  </Link>
                </Button>
              </div>
            )}
          </div>

          {/* Map — second in DOM, right column on desktop; CSS-hidden below
              1024px, matching the app's existing static-layout/CSS-
              breakpoint-toggle convention (see globals.css comment on
              .decisions-map-col). Shows every currently-saved place
              regardless of the pill filter. No click-to-select: Decisions
              just displays what's saved, it isn't filtered/selected via map
              interaction the way Discovery is — so selectedPlaceId/
              onPinClick are static/no-op. */}
          <div className="decisions-map-col">
            <DiscoveryMap
              places={mapPlaces}
              selectedPlaceId={null}
              onPinClick={() => {}}
            />
          </div>
        </div>
      )}
    </main>
  );
}
