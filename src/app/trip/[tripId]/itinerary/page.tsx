"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import {
  Timeline,
  Button,
  Badge,
  Skeleton,
  Alert,
  EmptyState,
} from "@sumiui/react";
import type { TimelineItemData } from "@sumiui/react";
import { Utensils, MapPin } from "lucide-react";

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
}

interface ItineraryResponse {
  tripId: number;
  days: DayResponse[];
  overflow?: Array<{ placeId: number | null; payload: Record<string, unknown> | null }>;
  neighborhood: string | null;
  status?: string;
}

function formatDayPill(isoDate: string, index: number): string {
  const d = new Date(isoDate + "T00:00:00Z");
  const month = d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `Day ${index + 1} · ${month}`;
}

function formatDate(isoDate: string): string {
  const d = new Date(isoDate + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
}

function segmentToTimelineItem(seg: SegmentRow, index: number): TimelineItemData {
  if (seg.segmentType === "place") {
    const name = seg.payload?.["placeName"] as string | undefined;
    const category = seg.payload?.["category"] as string | undefined;
    const isDetour = seg.payload?.["worthTheDetour"] === true;
    return {
      id: String(seg.id),
      time: seg.startTime ?? undefined,
      marker: "dot-ok",
      title: (
        <span className="flex items-center gap-2">
          <span
            className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: "var(--bg-2)" }}
            aria-hidden="true"
          >
            {category === "eat" ? (
              <Utensils size={14} style={{ color: "var(--fg-2)" }} />
            ) : (
              <MapPin size={14} style={{ color: "var(--fg-2)" }} />
            )}
          </span>
          <span>{name ?? "—"}</span>
          <Badge variant={category === "eat" ? "warning" : "info"}>
            {category === "eat" ? "Eat" : "Visit"}
          </Badge>
          {isDetour && <Badge variant="neutral">Detour</Badge>}
        </span>
      ),
    };
  }

  if (seg.segmentType === "pacing-block") {
    const label = seg.payload?.["label"] as string | undefined;
    const time = (seg.startTime && seg.endTime) ? `${seg.startTime} – ${seg.endTime}` : undefined;
    return {
      id: String(seg.id),
      time,
      marker: "dot-pending",
      title: label ?? "Rest",
      description: "Pacing block",
    };
  }

  // route
  const route = seg.payload as unknown as RouteResult | null;
  const label = route?.walkingMinutes != null
    ? `${route.walkingMinutes} min walk`
    : "Route";
  return {
    id: `route-${index}`,
    marker: route?.safetyConcern ? "dot-warn" : "dot-hollow",
    title: label,
    description: route?.safetyConcern
      ? `Safety note: ${route.safetyConcernName ?? "check area"}`
      : [route?.fromName, route?.toName].filter(Boolean).join(" → ") || undefined,
  };
}

function DaySection({ day }: { day: DayResponse }) {
  const items: TimelineItemData[] = day.segments.map(segmentToTimelineItem);
  const hasPlaces = day.segments.some((s) => s.segmentType === "place");

  const placeCount = day.segments.filter((s) => s.segmentType === "place").length;
  const walkMinutes = day.segments
    .filter((s) => s.segmentType === "route")
    .reduce((sum, s) => {
      const route = s.payload as unknown as RouteResult | null;
      return sum + (route?.walkingMinutes ?? 0);
    }, 0);

  return (
    <div className="mb-8" id={day.date}>
      <div className="flex items-center justify-between mb-4">
        <h2
          className="text-xs font-semibold uppercase tracking-widest"
          style={{ color: "var(--fg-3)" }}
        >
          {formatDate(day.date)}
        </h2>
        <div className="flex items-center gap-3 text-xs" style={{ color: "var(--fg-3)" }}>
          {placeCount > 0 && <span>{placeCount} place{placeCount !== 1 ? "s" : ""}</span>}
          {walkMinutes > 0 && <span>{walkMinutes} min walk</span>}
        </div>
      </div>
      {hasPlaces ? (
        <Timeline items={items} timeGutter />
      ) : (
        <p className="text-sm" style={{ color: "var(--fg-3)" }}>
          No places scheduled for this day.
        </p>
      )}
    </div>
  );
}

export default function ItineraryPage() {
  const params = useParams<{ tripId: string }>();
  const tripId = Number(params.tripId);

  const [state, setState] = useState<"idle" | "loading" | "building" | "done" | "error">("idle");
  const [data, setData] = useState<ItineraryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeDay, setActiveDay] = useState<string | null>(null);

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
        setActiveDay(json.days[0]?.date ?? null);
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
      setActiveDay(json.days[0]?.date ?? null);
      setState("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setState("error");
    }
  }

  function scrollToDay(date: string) {
    setActiveDay(date);
    document.getElementById(date)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <main className="max-w-lg mx-auto p-4 space-y-4">
      <div>
        <h1
          className="text-2xl font-bold tracking-tight"
          style={{ fontFamily: "var(--font-display)", color: "var(--fg-1)" }}
        >
          Itinerary
        </h1>
        {data?.neighborhood && (
          <p className="text-sm mt-0.5" style={{ color: "var(--fg-2)" }}>
            {data.neighborhood}
          </p>
        )}
      </div>

      {error && (
        <Alert variant="danger">
          {error}
          <Button variant="ghost" size="sm" className="ml-2" onClick={() => { void buildItinerary(); }}>
            Retry
          </Button>
        </Alert>
      )}

      {(state === "idle" || state === "done") && (
        <Button
          variant="primary"
          className="w-full"
          data-testid="build-itinerary-btn"
          onClick={() => { void buildItinerary(); }}
        >
          {state === "done" ? "Recompute itinerary" : "Build itinerary"}
        </Button>
      )}

      {state === "loading" && (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((n) => <Skeleton key={n} height="4rem" />)}
        </div>
      )}

      {state === "building" && (
        <div className="space-y-3">
          <p className="text-sm text-center" style={{ color: "var(--fg-2)" }}>
            Building your itinerary…
          </p>
          {[1, 2, 3, 4].map((n) => <Skeleton key={n} height="4rem" />)}
        </div>
      )}

      {state === "done" && data && (
        <>
          {data.days.length === 0 ? (
            <EmptyState
              title="No days scheduled"
              description="Add places in Discovery then build your itinerary."
            />
          ) : (
            <>
              {/* Day-switcher pill row */}
              <div
                className="flex gap-2 overflow-x-auto pb-2 scrollbar-none"
                role="group"
                aria-label="Jump to day"
              >
                {data.days.map((day, i) => {
                  const active = activeDay === day.date;
                  return (
                    <button
                      key={day.date}
                      aria-pressed={active}
                      onClick={() => scrollToDay(day.date)}
                      className="rounded-full px-4 py-2 text-sm font-medium shrink-0 transition-colors"
                      style={{
                        background: active ? "var(--accent)" : "transparent",
                        color: active ? "var(--fg-on-malachite)" : "var(--fg-2)",
                        border: `1px solid ${active ? "var(--accent)" : "var(--line-2)"}`,
                      }}
                    >
                      {formatDayPill(day.date, i)}
                    </button>
                  );
                })}
              </div>

              <div data-testid="itinerary-days">
                {data.days.map((day) => (
                  <DaySection key={day.date} day={day} />
                ))}
              </div>
            </>
          )}

          {data.overflow && data.overflow.length > 0 && (
            <Alert variant="warning">
              {data.overflow.length} place{data.overflow.length !== 1 ? "s" : ""} didn&apos;t fit in the schedule:{" "}
              {data.overflow
                .map((seg) => (seg.payload?.["placeName"] as string) ?? "Place")
                .join(", ")}
            </Alert>
          )}
        </>
      )}
    </main>
  );
}
