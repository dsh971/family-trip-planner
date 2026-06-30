"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Card,
  CardBody,
  CardFooter,
  Button,
  Badge,
  Alert,
  Skeleton,
  EmptyState,
} from "@sumiui/react";

const NeighborhoodMap = dynamic(
  () => import("@/components/ui/NeighborhoodMap"),
  { ssr: false, loading: () => <div className="w-full h-full flex items-center justify-center" style={{ color: "var(--fg-3)" }}>Loading map…</div> }
);

interface DayInTheLifePreview {
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

export default function NeighborhoodsPage() {
  const { tripId } = useParams<{ tripId: string }>();
  const router = useRouter();
  const [neighborhoods, setNeighborhoods] = useState<RankedNeighborhood[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mapVisible, setMapVisible] = useState(false);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/neighborhoods?destinationId=1");
      if (!res.ok) {
        setError("Failed to load neighborhoods");
        setLoading(false);
        return;
      }
      const data = await res.json() as RankedNeighborhood[];
      setNeighborhoods(data);
      setLoading(false);
    })();
  }, []);

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
        <Skeleton height="2rem" width="14rem" />
        <Skeleton height="1rem" width="20rem" />
        {[1, 2, 3].map((n) => (
          <Skeleton key={n} height="12rem" />
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

  return (
    <main className="p-4 pt-6 pb-20 max-w-5xl mx-auto">
      <div className="mb-4">
        <h1
          className="text-2xl font-bold tracking-tight"
          style={{ fontFamily: "var(--font-display)", color: "var(--fg-1)" }}
        >
          Choose Your Tokyo Base
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--fg-2)" }}>
          Ranked by family-friendliness. Pick one as your base area.
        </p>
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
          {neighborhoods.map((nb, i) => (
            <Card
              key={nb.id}
              style={
                selected === nb.id
                  ? { borderColor: "var(--accent)", background: "var(--bg-1)" }
                  : {}
              }
            >
              <CardBody className="space-y-2">
                <div className="flex items-center gap-2">
                  {/* Rank badge */}
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
                    <Badge variant="warning">Near flagged area</Badge>
                  )}
                </div>

                <ul className="text-sm space-y-0.5 list-disc list-inside" style={{ color: "var(--fg-2)" }}>
                  {nb.dayInTheLifePreview.highlights.map((h, j) => (
                    <li key={j}>{h}</li>
                  ))}
                </ul>
                <p className="text-sm" style={{ color: "var(--fg-2)" }}>
                  <span className="font-medium" style={{ color: "var(--fg-1)" }}>Sample day: </span>
                  {nb.dayInTheLifePreview.sampleBundle}
                </p>
                {nb.dayInTheLifePreview.safetyNote && (
                  <p className="text-xs" style={{ color: "var(--fg-3)" }}>
                    {nb.dayInTheLifePreview.safetyNote}
                  </p>
                )}

                {/* Score bar */}
                <div className="space-y-1 pt-1">
                  <div className="flex items-center justify-between text-xs" style={{ color: "var(--fg-3)" }}>
                    <span>Family score</span>
                    <span>{nb.familyFriendlinessScore}</span>
                  </div>
                  <div className="h-1.5 rounded-full" style={{ background: "var(--line-1)" }}>
                    <div
                      className="h-1.5 rounded-full transition-all"
                      style={{
                        width: `${nb.familyFriendlinessScore}%`,
                        background: "var(--accent)",
                      }}
                    />
                  </div>
                </div>
              </CardBody>
              <CardFooter>
                <Button
                  variant="primary"
                  size="sm"
                  loading={submitting === nb.id}
                  onClick={() => { void handleSelect(nb.id); }}
                >
                  Select as base
                </Button>
              </CardFooter>
            </Card>
          ))}
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
              // On mobile, switch to list view so the card is visible
              setMapVisible(false);
            }}
          />
        </div>
      </div>
    </main>
  );
}
