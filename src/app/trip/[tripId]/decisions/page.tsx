"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  Card,
  CardBody,
  Button,
  Badge,
  Skeleton,
  Alert,
  EmptyState,
} from "@sumiui/react";
import StepProgress from "@/components/ui/StepProgress";

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

  return (
    <main className="max-w-lg mx-auto p-4 space-y-4 pb-24">
      <div className="mb-4">
        <StepProgress currentStep="discover" />
      </div>

      <div>
        <h1
          className="text-2xl font-bold tracking-tight"
          style={{ fontFamily: "var(--font-display)", color: "var(--fg-1)" }}
        >
          Your picks
        </h1>
        <p className="text-sm mt-0.5" style={{ color: "var(--fg-2)" }}>
          Adjust your list here, then build your schedule.
        </p>

        {/* Stat chips */}
        {decisions.length > 0 && (
          <div className="flex gap-2 mt-2">
            <span
              className="rounded-full px-3 py-1 text-sm"
              style={{ background: "var(--bg-2)", color: "var(--fg-2)" }}
            >
              <span aria-hidden="true">🍜 </span>{countEat} restaurant{countEat !== 1 ? "s" : ""}
            </span>
            <span
              className="rounded-full px-3 py-1 text-sm"
              style={{ background: "var(--bg-2)", color: "var(--fg-2)" }}
            >
              <span aria-hidden="true">🏛 </span>{countVisit} {countVisit !== 1 ? "activities" : "activity"}
            </span>
          </div>
        )}
      </div>

      {error && <Alert variant="danger">{error}</Alert>}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((n) => <Skeleton key={n} height="5rem" />)}
        </div>
      ) : (
        <>
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
                  <Card
                    key={d.id}
                    style={{
                      borderLeft: `4px solid ${d.category === "eat" ? "var(--status-warning, #f59e0b)" : "var(--status-info, #3b82f6)"}`,
                    }}
                  >
                    <CardBody className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p
                          className="font-semibold text-sm truncate"
                          style={{ color: "var(--fg-1)" }}
                        >
                          {d.placeName ?? "—"}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          {d.rating !== null && (
                            <span className="text-xs flex items-center gap-0.5" style={{ color: "var(--fg-2)" }}>
                              <span className="text-yellow-500">★</span>
                              {d.rating.toFixed(1)}
                            </span>
                          )}
                          {d.priceLevel !== null && (
                            <span className="text-xs" style={{ color: "var(--fg-2)" }}>
                              {"$".repeat(d.priceLevel)}
                            </span>
                          )}
                          {d.worthTheDetour && (
                            <Badge variant="neutral">Detour</Badge>
                          )}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Remove ${d.placeName ?? "place"}`}
                        onClick={() => d.placeGoogleId && void removeDecision(d.placeGoogleId)}
                      >
                        ✕
                      </Button>
                    </CardBody>
                  </Card>
                ))}
                <p
                  className="text-xs text-center pt-2"
                  style={{ color: "var(--fg-3)", borderTop: "1px solid var(--line-1)" }}
                >
                  {filtered.length} {activeFilter === "eat" ? "restaurant" : "activity"}{filtered.length !== 1 ? "s" : ""} selected
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

          {/* Build schedule CTA */}
          {decisions.length > 0 && (
            <Button variant="primary" size="lg" className="w-full" asChild>
              <Link href={`/trip/${params.tripId}/itinerary`}>
                Build my schedule →
              </Link>
            </Button>
          )}
        </>
      )}
    </main>
  );
}
