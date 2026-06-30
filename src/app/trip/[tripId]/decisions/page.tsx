"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import {
  Card,
  CardBody,
  Button,
  Badge,
  Skeleton,
  Alert,
  EmptyState,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@sumiui/react";

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

export default function DecisionsPage() {
  const params = useParams<{ tripId: string }>();
  const tripId = Number(params.tripId);

  const [decisions, setDecisions] = useState<DecisionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"eat" | "visit">("eat");

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
  const filtered = decisions.filter((d) => d.category === activeTab);

  return (
    <main className="max-w-lg mx-auto p-4 space-y-4">
      <div>
        <h1
          className="text-2xl font-semibold tracking-tight"
          style={{ fontFamily: "var(--font-display)", color: "var(--fg-1)" }}
        >
          My Trip List
        </h1>
        <p className="text-sm mt-0.5" style={{ color: "var(--fg-2)" }}>
          Places you&apos;ve added
        </p>
      </div>

      {error && <Alert variant="danger">{error}</Alert>}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((n) => <Skeleton key={n} height="5rem" />)}
        </div>
      ) : (
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as "eat" | "visit")}
        >
          <TabsList>
            <TabsTrigger value="eat">Eat ({countEat})</TabsTrigger>
            <TabsTrigger value="visit">Visit ({countVisit})</TabsTrigger>
          </TabsList>

          <TabsContent value={activeTab} className="mt-3 space-y-3">
            {filtered.length === 0 ? (
              <EmptyState
                title={`No ${activeTab === "eat" ? "restaurants" : "activities"} yet`}
                description="Go to Discovery to add places."
              />
            ) : (
              <>
                {filtered.map((d) => (
                  <Card key={d.id}>
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
                  {filtered.length} {activeTab === "eat" ? "restaurant" : "activity"}{filtered.length !== 1 ? "s" : ""} selected
                </p>
              </>
            )}
          </TabsContent>
        </Tabs>
      )}
    </main>
  );
}
