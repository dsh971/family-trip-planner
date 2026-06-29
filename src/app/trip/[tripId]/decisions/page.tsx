"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";

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

function PriceDots({ level }: { level: number | null }) {
  if (level === null) return null;
  return (
    <span className="text-xs text-gray-500">
      {"$".repeat(level)}
    </span>
  );
}

function EmptyState({ tab }: { tab: "eat" | "visit" }) {
  return (
    <div className="text-center py-12 text-gray-400">
      <p className="text-sm">No {tab === "eat" ? "restaurants" : "activities"} added yet.</p>
      <p className="text-xs mt-1">Go to Discovery to add places.</p>
    </div>
  );
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
      if (!res.ok) {
        // Rollback on failure
        await loadDecisions();
      }
    } catch {
      await loadDecisions();
    }
  }

  const filtered = decisions.filter((d) => d.category === activeTab);

  return (
    <main className="min-h-screen bg-gray-50 p-4 max-w-lg mx-auto">
      <h1 className="text-xl font-bold text-gray-900 mb-1">Your Trip List</h1>
      <p className="text-sm text-gray-500 mb-4">Places you&apos;ve added to the trip</p>

      {error && (
        <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex gap-1 mb-4 bg-gray-100 rounded-lg p-1">
        {(["eat", "visit"] as const).map((tab) => {
          const count = decisions.filter((d) => d.category === tab).length;
          return (
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
              <span className="text-xs text-gray-400">({count})</span>
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400 text-sm">Loading…</div>
      ) : filtered.length === 0 ? (
        <EmptyState tab={activeTab} />
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((d) => (
            <div
              key={d.id}
              className={`border rounded-lg p-4 bg-white flex items-start justify-between gap-3 ${
                d.worthTheDetour ? "border-l-4 border-l-violet-400" : "border-gray-200"
              }`}
            >
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-900 text-sm truncate">{d.placeName ?? "—"}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  {d.rating !== null && (
                    <span className="text-xs text-gray-500 flex items-center gap-0.5">
                      <span className="text-yellow-500">★</span>
                      {d.rating.toFixed(1)}
                    </span>
                  )}
                  <PriceDots level={d.priceLevel} />
                  {d.worthTheDetour && (
                    <span className="text-xs px-1.5 py-0.5 bg-violet-100 text-violet-700 rounded font-medium">
                      Detour
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={() => d.placeGoogleId && void removeDecision(d.placeGoogleId)}
                className="text-xs text-gray-400 hover:text-red-500 transition-colors shrink-0 mt-0.5"
                aria-label={`Remove ${d.placeName ?? "place"}`}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="mt-4 pt-4 border-t border-gray-100 text-xs text-gray-400 text-center">
          {filtered.length} {activeTab === "eat" ? "restaurant" : "activity"}{filtered.length > 1 ? "s" : ""} selected
        </div>
      )}
    </main>
  );
}
