"use client";

import { useState, useCallback } from "react";
import { useParams } from "next/navigation";

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
  if (level === null) return <span className="text-gray-400 text-xs">—</span>;
  return (
    <span className="text-xs text-gray-600">
      {"$".repeat(level)}
      <span className="text-gray-300">{"$".repeat(Math.max(0, 4 - level))}</span>
    </span>
  );
}

function SourceBadge({ count }: { count: number }) {
  const color = count >= 3 ? "bg-green-100 text-green-800" : count > 0 ? "bg-blue-100 text-blue-800" : "bg-gray-100 text-gray-500";
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${color}`}>
      {count} src
    </span>
  );
}

function PlaceCard({
  place,
  onDecide,
}: {
  place: DiscoveryPlace;
  onDecide: (placeId: string, action: "yes" | "no") => void;
}) {
  const [decided, setDecided] = useState<"yes" | "no" | null>(null);

  function decide(action: "yes" | "no") {
    setDecided(action);
    onDecide(place.placeId, action);
  }

  if (decided === "no") return null;

  return (
    <div className={`border rounded-lg p-4 flex flex-col gap-2 ${decided === "yes" ? "border-green-400 bg-green-50" : "border-gray-200 bg-white"} ${place.nearSafetyArea ? "border-l-4 border-l-amber-400" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-gray-900 text-sm">{place.name}</h3>
          <p className="text-xs text-gray-500 mt-0.5">{place.types.slice(0, 2).join(" · ")}</p>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${place.category === "eat" ? "bg-orange-100 text-orange-700" : "bg-purple-100 text-purple-700"}`}>
          {place.category === "eat" ? "Eat" : "Visit"}
        </span>
      </div>

      <div className="flex items-center gap-3 text-xs text-gray-600">
        {place.rating !== null && (
          <span className="flex items-center gap-0.5">
            <span className="text-yellow-500">★</span>
            {place.rating.toFixed(1)}
            {place.reviewCount !== null && (
              <span className="text-gray-400 ml-0.5">({place.reviewCount.toLocaleString()})</span>
            )}
          </span>
        )}
        <PriceDots level={place.priceLevel} />
        <span className="text-gray-400">{Math.round(place.distanceFromCentroidMeters)}m</span>
      </div>

      <div className="flex items-center gap-2">
        <SourceBadge count={place.corroborationScore} />
        {place.goodForChildren && (
          <span className="text-xs px-1.5 py-0.5 bg-teal-100 text-teal-700 rounded font-medium">Kids ✓</span>
        )}
        {place.worthTheDetour && (
          <span className="text-xs px-1.5 py-0.5 bg-violet-100 text-violet-700 rounded font-medium">Worth detour</span>
        )}
        {place.nearSafetyArea && (
          <span className="text-xs px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded font-medium">Safety note</span>
        )}
      </div>

      {decided !== "yes" && (
        <div className="flex gap-2 mt-1">
          <button
            onClick={() => decide("yes")}
            className="flex-1 py-1.5 text-sm rounded-md bg-green-600 text-white hover:bg-green-700 transition-colors"
          >
            Add
          </button>
          <button
            onClick={() => decide("no")}
            className="flex-1 py-1.5 text-sm rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
          >
            Skip
          </button>
        </div>
      )}

      {decided === "yes" && (
        <p className="text-xs text-green-700 font-medium">Added to trip</p>
      )}
    </div>
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

  function handleDecide(placeId: string, action: "yes" | "no") {
    if (action !== "yes") return;
    fetch("/api/decisions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tripId, placeId, action: "yes" }),
    }).catch((e) => console.error("[Decision] Failed to persist", e));
  }

  const visiblePlaces = data?.results.filter((p) => p.category === activeTab) ?? [];

  return (
    <main className="min-h-screen bg-gray-50 p-4 max-w-lg mx-auto">
      <h1 className="text-xl font-bold text-gray-900 mb-1">Discover Places</h1>
      {data && (
        <p className="text-sm text-gray-500 mb-4">{data.neighborhoodName}</p>
      )}

      {state === "idle" && (
        <button
          onClick={runDiscovery}
          className="w-full py-3 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700 transition-colors"
        >
          Find family-friendly spots
        </button>
      )}

      {state === "loading" && (
        <div className="text-center py-12 text-gray-500">
          <div className="inline-block w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mb-3" />
          <p className="text-sm">Searching across sources…</p>
        </div>
      )}

      {state === "error" && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-sm text-red-700">{error}</p>
          <button
            onClick={runDiscovery}
            className="mt-2 text-sm text-red-600 underline"
          >
            Try again
          </button>
        </div>
      )}

      {state === "done" && data && (
        <>
          <div className="flex gap-1 mb-4 bg-gray-100 rounded-lg p-1">
            {(["eat", "visit"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 py-1.5 text-sm rounded-md font-medium transition-colors ${
                  activeTab === tab
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {tab === "eat" ? "Eat" : "Visit"}{" "}
                <span className="text-xs text-gray-400">
                  ({data.results.filter((p) => p.category === tab).length})
                </span>
              </button>
            ))}
          </div>

          {!data.wgAvailable && (
            <div className="mb-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
              WG CLI not available — showing web + Google Places results only
            </div>
          )}

          <div className="flex flex-col gap-3">
            {visiblePlaces.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-8">No places found in this category.</p>
            ) : (
              visiblePlaces.map((place) => (
                <PlaceCard key={place.placeId} place={place} onDecide={handleDecide} />
              ))
            )}
          </div>

          <button
            onClick={runDiscovery}
            className="w-full mt-4 py-2 text-sm text-indigo-600 border border-indigo-200 rounded-lg hover:bg-indigo-50 transition-colors"
          >
            Refresh results
          </button>
        </>
      )}
    </main>
  );
}
