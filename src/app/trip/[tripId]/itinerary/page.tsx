"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";

interface RouteResult {
  fromName: string;
  toName: string;
  distanceMeters: number | null;
  walkingMinutes: number | null;
  safetyConcern: boolean;
  safetyConcernName: string | null;
  wgAvailable: boolean;
  note: string | null;
}

interface SegmentRow {
  id: number;
  dayId: number;
  order: string;
  segmentType: "place" | "pacing-block" | "route";
  placeId: number | null;
  adjustmentState: string;
  startTime: string | null;
  endTime: string | null;
  payload: Record<string, unknown> | null;
}

interface DayResponse {
  date: string;
  dayId: number;
  segments: SegmentRow[];
  routes?: RouteResult[];
}

interface ItineraryResponse {
  tripId: number;
  days: DayResponse[];
  overflow?: Array<{ placeId: number | null; payload: Record<string, unknown> | null }>;
  neighborhood: string | null;
  status?: string;
}

function formatDate(isoDate: string): string {
  const d = new Date(isoDate + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
}

function RoutePill({ route }: { route: RouteResult }) {
  const label = route.walkingMinutes !== null
    ? `${route.walkingMinutes} min walk`
    : "Route unavailable";

  return (
    <div
      className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs border mx-auto w-fit ${
        route.safetyConcern
          ? "bg-amber-50 border-amber-300 text-amber-800"
          : "bg-gray-50 border-gray-200 text-gray-500"
      }`}
    >
      <span className="text-gray-400">↓</span>
      <span>{label}</span>
      {route.safetyConcern && (
        <span className="font-semibold text-amber-700">⚠ {route.safetyConcernName}</span>
      )}
    </div>
  );
}

function PlaceSegment({ seg }: { seg: SegmentRow }) {
  const name = seg.payload?.["placeName"] as string | undefined;
  const category = seg.payload?.["category"] as string | undefined;
  const isDetour = seg.payload?.["worthTheDetour"] === true;

  return (
    <div
      className={`rounded-lg border px-4 py-3 bg-white ${
        isDetour ? "border-l-4 border-l-violet-400 border-gray-200" : "border-gray-200"
      }`}
    >
      <div className="flex items-center justify-between">
        <p className="font-medium text-sm text-gray-900">{name ?? "—"}</p>
        <span
          className={`text-xs px-1.5 py-0.5 rounded font-medium ${
            category === "eat"
              ? "bg-orange-100 text-orange-700"
              : "bg-purple-100 text-purple-700"
          }`}
        >
          {category === "eat" ? "Eat" : "Visit"}
        </span>
      </div>
      {isDetour && (
        <p className="text-xs text-violet-600 mt-0.5">Worth the detour</p>
      )}
    </div>
  );
}

function PacingBlockSegment({ seg }: { seg: SegmentRow }) {
  const label = seg.payload?.["label"] as string | undefined;
  return (
    <div className="rounded-lg border border-dashed border-gray-200 px-4 py-2 bg-gray-50 text-center">
      <p className="text-xs text-gray-400 font-medium">{label ?? "Rest"}</p>
      {seg.startTime && (
        <p className="text-xs text-gray-300 mt-0.5">{seg.startTime} – {seg.endTime}</p>
      )}
    </div>
  );
}

function DayCard({ day }: { day: DayResponse }) {
  const placeSegments = day.segments.filter((s) => s.segmentType === "place");
  const routes = day.routes ?? [];

  // Interleave segments with route pills
  const interleaved: Array<{ type: "segment" | "route"; item: SegmentRow | RouteResult }> = [];
  let routeIdx = 0;
  for (let i = 0; i < day.segments.length; i++) {
    const seg = day.segments[i]!;
    interleaved.push({ type: "segment", item: seg });
    if (seg.segmentType === "place" && routes[routeIdx] && i < day.segments.length - 1) {
      const nextPlace = day.segments.slice(i + 1).find((s) => s.segmentType === "place");
      if (nextPlace) {
        interleaved.push({ type: "route", item: routes[routeIdx]! });
        routeIdx++;
      }
    }
  }

  return (
    <div className="mb-6">
      <h2 className="text-sm font-bold text-gray-600 uppercase tracking-wide mb-3">
        {formatDate(day.date)}
      </h2>
      <div className="flex flex-col gap-2">
        {interleaved.map((entry, i) =>
          entry.type === "segment" ? (
            (entry.item as SegmentRow).segmentType === "pacing-block" ? (
              <PacingBlockSegment key={`seg-${i}`} seg={entry.item as SegmentRow} />
            ) : (
              <PlaceSegment key={`seg-${i}`} seg={entry.item as SegmentRow} />
            )
          ) : (
            <RoutePill key={`route-${i}`} route={entry.item as RouteResult} />
          )
        )}
        {placeSegments.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-4">No places scheduled for this day.</p>
        )}
      </div>
    </div>
  );
}

export default function ItineraryPage() {
  const params = useParams<{ tripId: string }>();
  const tripId = Number(params.tripId);

  const [state, setState] = useState<"idle" | "loading" | "building" | "done" | "error">("idle");
  const [data, setData] = useState<ItineraryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadItinerary = useCallback(async () => {
    setState("loading");
    try {
      const res = await fetch(`/api/itinerary?tripId=${tripId}`);
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const json = await res.json() as ItineraryResponse;
      if (json.days.length === 0) {
        setState("idle");
      } else {
        setData(json);
        setState("done");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setState("error");
    }
  }, [tripId]);

  useEffect(() => {
    void loadItinerary();
  }, [loadItinerary]);

  async function buildItinerary() {
    setState("building");
    setError(null);
    try {
      const res = await fetch("/api/itinerary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tripId }),
      });
      if (!res.ok) {
        const body = await res.json() as { error?: string };
        throw new Error(body.error ?? `Server error ${res.status}`);
      }
      const json = await res.json() as ItineraryResponse;
      setData(json);
      setState("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setState("error");
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 p-4 max-w-lg mx-auto">
      <h1 className="text-xl font-bold text-gray-900 mb-1">Your Itinerary</h1>
      {data?.neighborhood && (
        <p className="text-sm text-gray-500 mb-4">{data.neighborhood}</p>
      )}

      {(state === "idle" || state === "done") && (
        <button
          onClick={buildItinerary}
          data-testid="build-itinerary-btn"
          className="w-full mb-4 py-2.5 bg-indigo-600 text-white rounded-lg font-semibold text-sm hover:bg-indigo-700 transition-colors"
        >
          {state === "done" ? "Recompute itinerary" : "Build itinerary"}
        </button>
      )}

      {state === "loading" && (
        <div className="text-center py-12 text-gray-400 text-sm">Loading itinerary…</div>
      )}

      {state === "building" && (
        <div className="text-center py-12 text-gray-500">
          <div className="inline-block w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mb-3" />
          <p className="text-sm">Building your itinerary…</p>
        </div>
      )}

      {state === "error" && (
        <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
          <button onClick={buildItinerary} className="ml-2 underline text-red-600">
            Retry
          </button>
        </div>
      )}

      {state === "done" && data && (
        <>
          <div data-testid="itinerary-days">
            {data.days.map((day) => (
              <DayCard key={day.date} day={day} />
            ))}
          </div>

          {data.overflow && data.overflow.length > 0 && (
            <div className="mt-4 border-t border-gray-200 pt-4">
              <h2 className="text-sm font-semibold text-gray-500 mb-2">Didn&apos;t fit</h2>
              <div className="flex flex-col gap-2">
                {data.overflow.map((seg, i) => (
                  <div key={i} className="border border-dashed border-gray-200 rounded-lg px-3 py-2 bg-white">
                    <p className="text-xs text-gray-500">{(seg.payload?.["placeName"] as string) ?? "Place"}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </main>
  );
}
