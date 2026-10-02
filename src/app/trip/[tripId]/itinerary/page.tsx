"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  Timeline,
  Button,
  Badge,
  Skeleton,
  Alert,
  EmptyState,
} from "@sumiui/react";
import type { TimelineItemData } from "@sumiui/react";
import { Utensils, MapPin, ExternalLink } from "lucide-react";
import EditorialBackdrop from "@/components/ui/EditorialBackdrop";
import PlacePeek from "@/components/ui/PlacePeek";
import { getPlaceGradient } from "@/lib/placeGradient";
import type { RouteMapStop } from "@/components/ui/RouteMap";

// ssr:false (matches DiscoveryMap's dynamic import in discovery/page.tsx) —
// react-leaflet touches `window` at module init, which breaks server
// rendering.
const RouteMap = dynamic(
  () => import("@/components/ui/RouteMap"),
  { ssr: false, loading: () => <div style={{ height: "100%" }} /> }
);

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
  pendingDecisionCount: number;
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

// Extracted so the peek preview (U9, plan 2026-09-12-001) can own its own
// open/close state — segmentToTimelineItem is a plain data-building
// function, not a component, so it can't call useState itself.
function ItineraryPlaceTitle({
  name,
  category,
  isDetour,
  photoReference,
  placeGoogleId,
  priceLevel,
  description,
}: {
  name: string;
  category: string | undefined;
  isDetour: boolean;
  photoReference: string | null | undefined;
  placeGoogleId: string | null | undefined;
  priceLevel: number | null | undefined;
  description: string | null | undefined;
}) {
  const [peekOpen, setPeekOpen] = useState(false);
  return (
    <span className="flex items-center gap-2">
      {/* Gradient + icon render unconditionally so a failed photo
          (dead/expired photo reference, see docs/plans/2026-09-12-001-
          fix-design-audit-bugs-plan.md U1) degrades to the same look as
          having no photo, instead of leaving an empty slot. */}
      <span
        className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 relative overflow-hidden"
        style={{ background: getPlaceGradient(name) }}
        aria-hidden="true"
      >
        {category === "eat" ? (
          <Utensils size={14} style={{ color: "rgba(255,255,255,0.85)" }} />
        ) : (
          <MapPin size={14} style={{ color: "rgba(255,255,255,0.85)" }} />
        )}
        {photoReference && (
          <img
            src={`/api/places/photo?ref=${encodeURIComponent(photoReference)}&width=64`}
            alt=""
            loading="lazy"
            className="absolute inset-0 w-8 h-8 rounded-lg"
            style={{ objectFit: "cover", display: "block" }}
            onError={(e) => { e.currentTarget.style.display = "none"; }}
          />
        )}
      </span>
      <span>{name}</span>
      <Badge variant={category === "eat" ? "warning" : "info"}>
        {category === "eat" ? "Eat" : "Visit"}
      </Badge>
      {isDetour && <Badge variant="neutral">Detour</Badge>}
      {/* In-app peek preview (U9, plan 2026-09-12-001), replacing the plain
          external link U7 shipped — see PlacePeek for why the content is
          what it is. Only present once the itinerary has been rebuilt
          after this unit shipped (scheduler.ts now threads placeGoogleId,
          priceLevel, and description into the payload; older segments
          predate that and simply omit the link). */}
      {placeGoogleId && (
        <div style={{ position: "relative", display: "inline-flex" }}>
          <button
            type="button"
            onClick={() => setPeekOpen((v) => !v)}
            aria-label="View photos on Google Maps"
            title="View photos on Google Maps"
            style={{ color: "var(--fg-3)", display: "inline-flex", background: "none", border: "none", padding: 0, cursor: "pointer" }}
          >
            <ExternalLink size={12} />
          </button>
          {peekOpen && (
            <PlacePeek
              name={name}
              category={category === "eat" ? "eat" : "visit"}
              priceLevel={priceLevel ?? null}
              description={description ?? null}
              placeGoogleId={placeGoogleId}
              onClose={() => setPeekOpen(false)}
            />
          )}
        </div>
      )}
    </span>
  );
}

function segmentToTimelineItem(seg: SegmentRow, index: number): TimelineItemData {
  if (seg.segmentType === "place") {
    const name = seg.payload?.["placeName"] as string | undefined;
    const category = seg.payload?.["category"] as string | undefined;
    const isDetour = seg.payload?.["worthTheDetour"] === true;
    const photoReference = seg.payload?.["photoReference"] as string | null | undefined;
    const placeGoogleId = seg.payload?.["placeGoogleId"] as string | null | undefined;
    const priceLevel = seg.payload?.["priceLevel"] as number | null | undefined;
    const description = seg.payload?.["description"] as string | null | undefined;
    return {
      id: String(seg.id),
      time: seg.startTime ?? undefined,
      marker: "dot-ok",
      title: (
        <ItineraryPlaceTitle
          name={name ?? "—"}
          category={category}
          isDetour={isDetour}
          photoReference={photoReference}
          placeGoogleId={placeGoogleId}
          priceLevel={priceLevel}
          description={description}
        />
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
  // Design-fidelity fix (2026-08-23): walkingMinutes is a raw computed
  // float (distance / walking speed) — was rendering as e.g.
  // "3.8216666666666668 min walk" verbatim. Round for display only; the
  // underlying value is unaffected for any calculation.
  const label =
    route?.walkingMinutes != null ? (
      <span>
        <span style={{ fontFamily: "var(--font-mono)" }}>{Math.round(route.walkingMinutes)}</span> min walk
      </span>
    ) : (
      "Route"
    );
  return {
    id: `route-${index}`,
    marker: route?.safetyConcern ? "dot-warn" : "dot-hollow",
    title: label,
    description: route?.safetyConcern
      ? `Safety note: ${route.safetyConcernName ?? "check area"}`
      : [route?.fromName, route?.toName].filter(Boolean).join(" → ") || undefined,
  };
}

// idPrefix (U7, plan 2026-08-23-002): the desktop split-pane renders the
// active day's DaySection alongside the mobile continuous list (both stay
// mounted simultaneously — CSS, not JS, decides which is visible per
// breakpoint, see the .itinerary-mobile-only/.itinerary-desktop-split
// comment below). Without a distinguishing id, two DaySections for the
// same day (mobile's full list + desktop's single active day) would both
// render `id={day.date}`, producing a duplicate-id DOM. scrollToDay (mobile
// jump-nav) always targets the plain, unprefixed id, so only the desktop
// render passes a prefix.
// Route-map stops for a day (U7): lat/lng now flow through each "place"
// segment's payload (added in scheduler.ts's DecisionItem→SegmentSpec
// construction alongside the existing photoReference field, same
// `?? null` pattern) — no second lookup needed. Stops without resolved
// coordinates (lat/lng null) are skipped rather than plotted at (0,0).
function dayToRouteStops(day: DayResponse): RouteMapStop[] {
  return day.segments
    .filter((s) => s.segmentType === "place")
    .map((s) => {
      const lat = s.payload?.["lat"] as number | null | undefined;
      const lng = s.payload?.["lng"] as number | null | undefined;
      const name = s.payload?.["placeName"] as string | undefined;
      if (lat == null || lng == null) return null;
      return { id: String(s.id), name: name ?? "—", lat, lng };
    })
    .filter((s): s is RouteMapStop => s !== null);
}

function DaySection({ day, idPrefix }: { day: DayResponse; idPrefix?: string }) {
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
    <div className="mb-4" id={idPrefix ? `${idPrefix}-${day.date}` : day.date}>
      <div className="flex items-center justify-between mb-3">
        {/* Use div not h2 — sumiui applies display font + large size to h2 globally */}
        <div
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: "0.6875rem",
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: "var(--fg-3)",
          }}
        >
          {formatDate(day.date)}
        </div>
        <div className="flex items-center gap-3 text-xs" style={{ color: "var(--fg-3)", fontFamily: "var(--font-mono)" }}>
          {placeCount > 0 && <span>{placeCount} place{placeCount !== 1 ? "s" : ""}</span>}
          {walkMinutes > 0 && <span>{Math.round(walkMinutes)} min walk</span>}
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

  const [state, setState] = useState<"loading" | "building" | "done" | "empty" | "error">("loading");
  const [data, setData] = useState<ItineraryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeDay, setActiveDay] = useState<string | null>(null);

  const buildItinerary = useCallback(async () => {
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
  }, [tripId]);

  const loadItinerary = useCallback(async () => {
    setState("loading");
    try {
      const res = await fetch(`/api/itinerary?tripId=${tripId}`);
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const json = await res.json() as ItineraryResponse;
      if (json.days.length === 0) {
        if (json.pendingDecisionCount > 0) {
          await buildItinerary();
        } else {
          setState("empty");
        }
      } else {
        setData(json);
        setActiveDay(json.days[0]?.date ?? null);
        setState("done");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setState("error");
    }
  }, [tripId, buildItinerary]);

  useEffect(() => {
    void loadItinerary();
  }, [loadItinerary]);

  function scrollToDay(date: string) {
    setActiveDay(date);
    document.getElementById(date)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  if (state === "empty") {
    return (
      <main className="max-w-lg mx-auto p-4 space-y-4">
        <div>
          {/* Design-fidelity fix (2026-08-23): see neighborhoods/page.tsx's
              identical h1 comment — Sumi's unlayered h1 base rule always
              beats the text-2xl/font-bold/tracking-tight utility classes. */}
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
            Your schedule
          </h1>
        </div>
        <EmptyState
          title="No places added yet"
          description="Go back to discovery and add some places to your trip."
        />
        <div className="mt-4">
          <Link
            href={`/trip/${tripId}/discovery`}
            style={{ color: "var(--accent)", fontSize: "0.875rem" }}
          >
            ← Discover places
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="itinerary-shell max-w-lg mx-auto p-4 space-y-4" style={{ position: "relative" }}>
      <EditorialBackdrop variant="light" />
      <div>
        {/* Design-fidelity fix (2026-08-23): see neighborhoods/page.tsx's
            identical h1 comment — Sumi's unlayered h1 base rule always
            beats the text-2xl/font-bold/tracking-tight utility classes. */}
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
          Your schedule
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
          <Button variant="ghost" size="sm" className="ml-2 rounded-xl" onClick={() => { void buildItinerary(); }}>
            Retry
          </Button>
        </Alert>
      )}

      {state === "loading" && (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((n) => <Skeleton key={n} height="4rem" />)}
        </div>
      )}

      {state === "building" && (
        <div className="space-y-3">
          <p className="text-sm text-center" style={{ color: "var(--fg-2)" }}>
            Building your schedule…
          </p>
          {[1, 2, 3, 4].map((n) => <Skeleton key={n} height="4rem" />)}
        </div>
      )}

      {state === "done" && data && (
        <>
          <Button
            variant="secondary"
            className="w-full rounded-xl"
            data-testid="rebuild-btn"
            onClick={() => { void buildItinerary(); }}
          >
            Rebuild schedule
          </Button>

          {data.days.length === 0 ? (
            <EmptyState
              title="No days scheduled"
              description="Add places in Discovery then rebuild your schedule."
            />
          ) : (
            <>
              {/* Mobile (< 1024px): unchanged continuous-scroll-with-jump-nav
                  behavior — pills scroll to a day's anchor, every day's full
                  timeline stays mounted and scrollable in one column. Kept
                  byte-for-byte in behavior; only wrapped in a CSS-hidden-at-
                  desktop container (U7, plan 2026-08-23-002) so the desktop
                  split-pane below can render independently rather than
                  reusing (and complicating) this JS handler. */}
              <div className="itinerary-mobile-only">
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
              </div>

              {/* Desktop (>= 1024px), U7: day pills filter the visible
                  timeline to one day instead of scrolling to an anchor —
                  the list column shows only the active day, and a route map
                  with numbered pins fills the remaining width. Same
                  `activeDay` state as mobile (defaults to the first day when
                  null), so switching days here or on mobile (if the
                  viewport were resized) stays in sync. */}
              {(() => {
                const activeDayData =
                  data.days.find((d) => d.date === activeDay) ?? data.days[0];
                const routeStops = dayToRouteStops(activeDayData);
                return (
                  <div className="itinerary-desktop-split" data-testid="itinerary-desktop-split">
                    <div className="itinerary-desktop-list-col">
                      {/* Wraps instead of scrolling, unlike the mobile jump-nav
                          row below — a fixed 460px sidebar column with no
                          scrollbar and no fade hint left every day past the
                          4th genuinely invisible and undiscoverable on a
                          longer trip (confirmed directly: 11 days, only ~4
                          fit in view, scrollWidth 1405px vs clientWidth
                          460px). Horizontal scroll is an expected, discoverable
                          pattern on mobile touch; it isn't here. */}
                      <div
                        className="flex flex-wrap gap-2 pb-2"
                        role="group"
                        aria-label="Select day"
                      >
                        {data.days.map((day, i) => {
                          const active = activeDayData.date === day.date;
                          return (
                            <button
                              key={day.date}
                              aria-pressed={active}
                              onClick={() => setActiveDay(day.date)}
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

                      <div data-testid="itinerary-desktop-day">
                        <DaySection day={activeDayData} idPrefix="desktop" />
                      </div>
                    </div>

                    <div className="itinerary-desktop-map-col">
                      <RouteMap stops={routeStops} />
                    </div>
                  </div>
                );
              })()}
            </>
          )}

          {data.overflow && data.overflow.length > 0 && (
            <div className="space-y-2">
              <Alert variant="warning">
                {data.overflow.length} place{data.overflow.length !== 1 ? "s" : ""} couldn&apos;t fit into your schedule.
                You can rebuild to redistribute, or{" "}
                <Link href={`/trip/${tripId}/decisions`} style={{ textDecoration: "underline" }}>
                  edit your picks
                </Link>
                .
              </Alert>
            </div>
          )}

          <div style={{ textAlign: "center", paddingTop: "8px" }}>
            <Link
              href={`/trip/${tripId}/decisions`}
              style={{ fontSize: "0.8rem", color: "var(--fg-3)" }}
            >
              ← Edit picks
            </Link>
          </div>
        </>
      )}
    </main>
  );
}
