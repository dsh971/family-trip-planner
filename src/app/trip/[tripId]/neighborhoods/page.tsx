"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Card,
  CardHeader,
  CardBody,
  CardFooter,
  Button,
  Badge,
  Alert,
  Skeleton,
  EmptyState,
} from "@sumiui/react";

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
}

export default function NeighborhoodsPage() {
  const { tripId } = useParams<{ tripId: string }>();
  const router = useRouter();
  const [neighborhoods, setNeighborhoods] = useState<RankedNeighborhood[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
    <main className="max-w-2xl mx-auto p-4 pt-6 space-y-4">
      <div>
        <h1
          className="text-2xl font-semibold tracking-tight"
          style={{ fontFamily: "var(--font-display)", color: "var(--fg-1)" }}
        >
          Choose Your Tokyo Base
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--fg-2)" }}>
          Ranked by family-friendliness. Pick one as your base area.
        </p>
      </div>

      <div className="space-y-3">
        {neighborhoods.map((nb, i) => (
          <Card
            key={nb.id}
            style={
              selected === nb.id
                ? { borderColor: "var(--accent)", background: "var(--bg-1)" }
                : {}
            }
          >
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span
                  className="text-xs font-semibold tabular-nums w-5 text-center"
                  style={{ color: "var(--fg-3)" }}
                >
                  #{i + 1}
                </span>
                <span
                  className="text-base font-semibold"
                  style={{ color: "var(--fg-1)" }}
                >
                  {nb.name}
                </span>
                {nb.safetyPenalty > 0 && (
                  <Badge variant="warning">
                    Near flagged area
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardBody className="space-y-2">
              <ul
                className="text-sm space-y-0.5 list-disc list-inside"
                style={{ color: "var(--fg-2)" }}
              >
                {nb.dayInTheLifePreview.highlights.map((h, j) => (
                  <li key={j}>{h}</li>
                ))}
              </ul>
              <p className="text-sm" style={{ color: "var(--fg-2)" }}>
                <span className="font-medium" style={{ color: "var(--fg-1)" }}>
                  Sample day:{" "}
                </span>
                {nb.dayInTheLifePreview.sampleBundle}
              </p>
              {nb.dayInTheLifePreview.safetyNote && (
                <p className="text-xs" style={{ color: "var(--fg-3)" }}>
                  {nb.dayInTheLifePreview.safetyNote}
                </p>
              )}
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
    </main>
  );
}
