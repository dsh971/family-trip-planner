"use client";

import { useState, useCallback } from "react";
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
  nearSafetyArea?: boolean;
  rankPosition: number;
}

interface DiscoveryResponse {
  neighborhoodId: number;
  neighborhoodName: string;
  results: DiscoveryPlace[];
  wgAvailable: boolean;
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
  onDecide,
}: {
  place: DiscoveryPlace;
  onDecide: (placeId: string, action: "yes" | "no", worthTheDetour: boolean) => void;
}) {
  const [decided, setDecided] = useState<"yes" | "no" | null>(null);

  function decide(action: "yes" | "no") {
    setDecided(action);
    onDecide(place.placeId, action, place.worthTheDetour);
  }

  if (decided === "no") return null;

  return (
    <Card style={decided === "yes" ? { borderColor: "var(--success, #4ade80)" } : {}}>
      <CardBody className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold" style={{ color: "var(--fg-1)" }}>
              {place.name}
            </h3>
            <p className="text-xs mt-0.5" style={{ color: "var(--fg-3)" }}>
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
          <span style={{ color: "var(--fg-3)" }}>{Math.round(place.distanceFromCentroidMeters)}m</span>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {place.corroborationScore >= 2 && (
            <Badge variant={place.corroborationScore >= 3 ? "success" : "info"}>
              {place.corroborationScore} src
            </Badge>
          )}
          {place.goodForChildren && <Badge variant="success">Kids ✓</Badge>}
          {place.worthTheDetour && <Badge variant="neutral">Worth detour</Badge>}
          {place.nearSafetyArea && <Badge variant="warning">Safety note</Badge>}
        </div>

        {decided !== "yes" ? (
          <div className="flex gap-2 pt-1">
            <Button variant="primary" size="sm" className="flex-1" onClick={() => decide("yes")}>
              Add
            </Button>
            <Button variant="ghost" size="sm" className="flex-1" onClick={() => decide("no")}>
              Skip
            </Button>
          </div>
        ) : (
          <p className="text-xs font-medium" style={{ color: "var(--success, #16a34a)" }}>
            Added to trip
          </p>
        )}
      </CardBody>
    </Card>
  );
}

export default function DiscoveryPage() {
  const params = useParams<{ tripId: string }>();
  const tripId = Number(params.tripId);

  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [data, setData] = useState<DiscoveryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"eat" | "visit">("eat");

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

  function handleDecide(placeId: string, action: "yes" | "no", worthTheDetour: boolean) {
    if (action !== "yes") return;
    fetch("/api/decisions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tripId, placeId, action: "yes", worthTheDetour }),
    }).catch((e) => console.error("[Decision] Failed to persist", e));
  }

  const visiblePlaces = data?.results.filter((p) => p.category === activeTab) ?? [];
  const countEat = data?.results.filter((p) => p.category === "eat").length ?? 0;
  const countVisit = data?.results.filter((p) => p.category === "visit").length ?? 0;

  return (
    <main className="max-w-lg mx-auto p-4 space-y-4">
      <div>
        <h1
          className="text-2xl font-semibold tracking-tight"
          style={{ fontFamily: "var(--font-display)", color: "var(--fg-1)" }}
        >
          Discover Places
        </h1>
        {data && (
          <p className="text-sm mt-0.5" style={{ color: "var(--fg-2)" }}>
            {data.neighborhoodName}
          </p>
        )}
      </div>

      {state === "idle" && (
        <Button variant="primary" size="lg" className="w-full" onClick={() => { void runDiscovery(); }}>
          Find family-friendly spots
        </Button>
      )}

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
          {!data.wgAvailable && (
            <Alert variant="warning">
              WG CLI not available — showing web + Google Places results only
            </Alert>
          )}

          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as "eat" | "visit")}
          >
            <TabsList>
              <TabsTrigger value="eat">Eat ({countEat})</TabsTrigger>
              <TabsTrigger value="visit">Visit ({countVisit})</TabsTrigger>
            </TabsList>

            <TabsContent value={activeTab} className="mt-3 space-y-3">
              {visiblePlaces.length === 0 ? (
                <EmptyState
                  title="No places yet"
                  description="Nothing found in this category."
                />
              ) : (
                visiblePlaces.map((place) => (
                  <PlaceCard key={place.placeId} place={place} onDecide={handleDecide} />
                ))
              )}
            </TabsContent>
          </Tabs>

          <Button variant="secondary" className="w-full" onClick={() => { void runDiscovery(); }}>
            Refresh results
          </Button>
        </>
      )}
    </main>
  );
}
