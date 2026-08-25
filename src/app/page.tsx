"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@sumiui/react";
import { Search } from "lucide-react";
import { getActiveTripId, clearActiveTripId } from "@/lib/activeTrip";
import { WebNav } from "@/components/ui/WebNav";

// Design-fidelity fix (2026-08-22, revised 2026-08-23): the shipped Home
// page had drifted from the Hybrid mockup it was meant to implement.
//
// The 2026-08-23 revision corrects a wrong first attempt: the mobile-only
// scratchpad copy of the design canvas was gone (session scratchpad cleared
// overnight) by the time a desktop-viewport bug report came in, so the
// initial desktop fix improvised a split text/cover-art-panel layout that
// was never actually part of the design. The real desktop mockup
// (Web-Home.dc.html, recovered from the published design artifact) keeps
// the SAME full-bleed dark gradient/grid/pins treatment as mobile at every
// width — only the text scale and vertical arrangement change: headline
// anchored near the top, description/CTA anchored near the bottom, huge
// serif type (112-128px at 1440px) instead of a centered narrow column.
//
// Known, deliberate simplifications vs. the mockup:
// - One shared gradient/grid/glow definition across breakpoints, not the
//   mockup's slightly different desktop-specific angle/spacing values
//   (120deg/88px/50% vs mobile's 155deg/72px/55%) — the visual difference
//   is negligible and not worth a breakpoint-specific background rule.
// - No "Explore on map →" secondary CTA (desktop mockup's hasTrip state has
//   one) — this app has no map-browsing feature independent of the trip
//   flow to route it to; adding it would be a dead link.
// - No WebNav import (desktop mockup's shared top nav: Home/Trip setup/
//   Discover/Saved/Itinerary links + trip-context pill + user avatar) —
//   this app has no auth/avatar system, and the four non-Home links don't
//   correspond to real standalone pages (they're nested under an active
//   trip's /trip/[tripId]/... routes, meaningless without one). Building
//   that nav here would mean real, permanently-broken links.

interface DestinationSuggestion {
  id: number;
  name: string;
  country: string;
  slug: string;
}

interface ActiveTrip {
  id: number;
  status: string;
  destinationName: string;
  startDate: string;
}

interface PinSpec {
  left: string;
  top: string;
  opacity: number;
  size: number;
}

// Percentages converted from the mockups' absolute pixel positions (390x844
// mobile canvas, 1440x900 desktop canvas) — kept as one set per breakpoint
// per state rather than a single scaled set, since the mockups themselves
// used genuinely different pin arrangements per state, not a shared layout
// with different text overlaid.
const MOBILE_PINS_HAS_TRIP: PinSpec[] = [
  { left: "38.5%", top: "30.8%", opacity: 0.7, size: 18 },
  { left: "62.8%", top: "23.7%", opacity: 0.5, size: 14 },
];
const MOBILE_PINS_NO_TRIP: PinSpec[] = [
  { left: "15.4%", top: "17.8%", opacity: 0.55, size: 12 },
  { left: "74.4%", top: "26.1%", opacity: 0.45, size: 12 },
  { left: "51.3%", top: "40.3%", opacity: 0.35, size: 12 },
];
const DESKTOP_PINS_HAS_TRIP: PinSpec[] = [
  { left: "62.5%", top: "24.4%", opacity: 0.75, size: 26 },
  { left: "75%", top: "42.2%", opacity: 0.55, size: 18 },
  { left: "84.7%", top: "20%", opacity: 0.4, size: 14 },
];
const DESKTOP_PINS_NO_TRIP: PinSpec[] = [
  { left: "52.8%", top: "20%", opacity: 0.5, size: 14 },
  { left: "69.4%", top: "37.8%", opacity: 0.4, size: 14 },
  { left: "83.3%", top: "27.8%", opacity: 0.3, size: 14 },
];

function Pin({ left, top, opacity, size }: PinSpec) {
  const height = Math.round(size * 1.25);
  return (
    <svg
      aria-hidden="true"
      style={{ position: "absolute", left, top, opacity }}
      width={size}
      height={height}
      viewBox="0 0 32 40"
    >
      <path d="M16 0C7 0 0 7 0 16c0 11 16 24 16 24s16-13 16-24C32 7 25 0 16 0z" fill="var(--malachite-300)" />
      <circle cx="16" cy="16" r="6" fill="var(--ink-900)" />
    </svg>
  );
}

// Mirrors src/app/profile/page.tsx's identical debounced search-as-you-type
// pattern against GET /api/destinations?q=.
const DESTINATION_SEARCH_DEBOUNCE_MS = 200;

function daysUntil(dateStr: string): number | null {
  const target = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - now.getTime()) / 86_400_000);
}

// Routes "Continue planning" to wherever this trip actually left off,
// mirroring the stage names in trips.status (src/db/schema.ts).
function continueRoute(tripId: number, status: string): string {
  switch (status) {
    case "ProfileSetup":
      return `/trip/${tripId}/profile`;
    case "NeighborhoodSelection":
      return `/trip/${tripId}/neighborhoods`;
    case "Discovery":
    case "DecisionMaking":
      return `/trip/${tripId}/discovery`;
    default:
      return `/trip/${tripId}/itinerary`;
  }
}

export default function Home() {
  const router = useRouter();

  const [checkedActiveTrip, setCheckedActiveTrip] = useState(false);
  const [activeTrip, setActiveTrip] = useState<ActiveTrip | null>(null);

  const [destinationName, setDestinationName] = useState("");
  const [selectedDestination, setSelectedDestination] = useState<DestinationSuggestion | null>(null);
  const [suggestions, setSuggestions] = useState<DestinationSuggestion[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const storedId = getActiveTripId();
    if (!storedId) {
      setCheckedActiveTrip(true);
      return;
    }
    void (async () => {
      try {
        const res = await fetch(`/api/trips/${storedId}`);
        if (!res.ok) {
          // Trip was deleted, or the id is stale/invalid — fall back to
          // the "no trip" view rather than getting stuck.
          clearActiveTripId();
          return;
        }
        const data = await res.json() as ActiveTrip;
        setActiveTrip(data);
      } catch {
        // Network error — treat as no active trip rather than blocking Home.
      } finally {
        setCheckedActiveTrip(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const query = destinationName.trim();
    if (!query || selectedDestination !== null) return;

    debounceRef.current = setTimeout(() => {
      fetch(`/api/destinations?q=${encodeURIComponent(query)}`)
        .then((res) => (res.ok ? (res.json() as Promise<DestinationSuggestion[]>) : []))
        .then((results) => {
          setSuggestions(results);
          setSuggestionsOpen(results.length > 0);
        })
        .catch(() => {
          setSuggestions([]);
          setSuggestionsOpen(false);
        });
    }, DESTINATION_SEARCH_DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [destinationName, selectedDestination]);

  // Reset affordance (plan 2026-08-24-001, U1): the only in-app way to
  // abandon an active trip and start over. Non-destructive — clears only
  // the local active-trip pointer, so the trip's data stays reachable at
  // its own URL — hence no confirmation dialog before firing.
  const handleResetTrip = useCallback(() => {
    clearActiveTripId();
    setActiveTrip(null);
  }, []);

  const handleStartNewTrip = useCallback(() => {
    // Carries whatever the traveler typed/picked into /profile's own
    // destination field instead of making them retype it — the search box
    // here is a head start into the same full trip-setup flow, not a
    // separate path.
    const params = new URLSearchParams();
    if (selectedDestination) {
      params.set("destinationId", String(selectedDestination.id));
      params.set("destinationName", selectedDestination.name);
      if (selectedDestination.country) params.set("destinationCountry", selectedDestination.country);
    } else if (destinationName.trim()) {
      params.set("destinationName", destinationName.trim());
    }
    router.push(`/profile${params.size > 0 ? `?${params.toString()}` : ""}`);
  }, [router, selectedDestination, destinationName]);

  if (!checkedActiveTrip) {
    return <main className="home-hero" style={{ background: "var(--ink-900)" }} />;
  }

  const days = activeTrip ? daysUntil(activeTrip.startDate) : null;
  const pins = activeTrip
    ? { mobile: MOBILE_PINS_HAS_TRIP, desktop: DESKTOP_PINS_HAS_TRIP }
    : { mobile: MOBILE_PINS_NO_TRIP, desktop: DESKTOP_PINS_NO_TRIP };

  return (
    <main
      className="home-hero"
      style={{
        background: "linear-gradient(155deg, var(--ink-900) 0%, var(--malachite-900) 55%, var(--malachite-800) 100%)",
        color: "var(--fg-on-ink)",
      }}
    >
      {/* Background texture: grid + radial glow, matching Web-Home.dc.html */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0.35,
          backgroundImage:
            "repeating-linear-gradient(0deg, rgba(238,231,214,0.06) 0 1px, transparent 1px 72px), repeating-linear-gradient(90deg, rgba(238,231,214,0.06) 0 1px, transparent 1px 72px)",
        }}
      />
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          background: "radial-gradient(circle at 78% 12%, rgba(79,132,102,0.2) 0%, transparent 55%)",
        }}
      />

      <div className="home-hero-pins-mobile">
        {pins.mobile.map((p, i) => <Pin key={i} {...p} />)}
      </div>
      <div className="home-hero-pins-desktop">
        {pins.desktop.map((p, i) => <Pin key={i} {...p} />)}
      </div>

      {/* Bottom vignette so bottom-anchored text stays legible over the pins */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          background: "linear-gradient(180deg, transparent 0%, transparent 45%, rgba(14,13,12,0.6) 75%, var(--ink-900) 100%)",
        }}
      />

      {/* Mobile only (Hybrid-Home.dc.html has no nav chrome at all) — hidden
          at >=1024px via .mobile-chrome, same convention as AppHeader/
          BottomNav. Desktop gets the real WebNav below instead, matching
          Web-Home.dc.html's `<dc-import name="WebNav" active="home">` —
          discovered missing (Home had no way back from the desktop nav at
          all) after a direct user report; the earlier build of this unit
          only wired WebNav into non-Home routes. */}
      <div className="home-hero-header mobile-chrome">
        <span style={{ display: "flex", alignItems: "baseline", gap: "8px" }}>
          <span className="text-lg font-bold" style={{ fontFamily: "var(--font-display)" }}>
            Viridian
          </span>
          {/* Tagline: shown here (more room, one full-bleed moment) but not
              in AppHeader/WebNav's compact persistent bar — see Key
              Technical Decisions in docs/plans/2026-08-23-001-feat-viridian-
              rebrand-plan.md, U1. */}
          <span
            className="text-xs"
            style={{ color: "var(--ink-300)", letterSpacing: "0.02em" }}
          >
            Family Trip Planner
          </span>
        </span>
      </div>

      {/* Desktop (>=1024px) — real WebNav, matching Web-Home.dc.html's
          `<dc-import name="WebNav" active="home">`. tripId is passed when
          an active trip exists so Area/Discover/Plan link to it instead of
          rendering disabled — the mockup itself is a static demo and
          doesn't model this, but every other page's WebNav usage is
          trip-data-aware, and there's no reason Home's shouldn't be too. */}
      <WebNav tripId={activeTrip ? String(activeTrip.id) : undefined} />

      <div className="home-hero-content">
        {activeTrip ? (
          <>
            <div className="home-hero-headline-block">
              <p
                className="text-xs uppercase font-semibold mb-2"
                style={{ color: "var(--ink-300)", letterSpacing: "0.18em" }}
              >
                Your next trip
              </p>
              <h1
                className="home-hero-headline"
                style={{
                  fontFamily: "var(--font-display)",
                  // Explicit overrides, not classNames: Sumi's own base CSS
                  // sets h1's font-weight/color/line-height/letter-spacing/
                  // margin unconditionally and UNLAYERED — unlayered CSS
                  // always beats layered utility classes regardless of
                  // specificity or source order (CSS Cascade Layers spec),
                  // so font-bold/tracking-* classes silently do nothing on
                  // any heading element anywhere in this app. Verified via
                  // computed styles: without this, headings render at
                  // Sumi's own default size/weight, not the intended one.
                  fontWeight: 700,
                  color: "var(--fg-on-ink)",
                  lineHeight: 0.98,
                  letterSpacing: "-0.01em",
                  margin: 0,
                }}
              >
                {activeTrip.destinationName}
              </h1>
              <p className="text-sm leading-relaxed mt-4 max-w-md" style={{ color: "var(--silk-500)" }}>
                Pick up where you left off — neighborhoods, food, and a route that flows.
              </p>
            </div>
            <div className="home-hero-bottom-block">
              {days !== null && (
                <div
                  className="mb-4 text-xs"
                  style={{ fontFamily: "var(--font-mono)", color: "var(--ink-300)" }}
                >
                  {days >= 0 ? `T-${days} days` : "Trip in progress"}
                </div>
              )}
              <Button
                variant="primary"
                size="lg"
                className="w-full"
                onClick={() => router.push(continueRoute(activeTrip.id, activeTrip.status))}
              >
                Continue planning
              </Button>
              <button
                type="button"
                onClick={handleResetTrip}
                style={{
                  display: "block",
                  width: "100%",
                  marginTop: "12px",
                  padding: 0,
                  textAlign: "center",
                  fontSize: "0.8125rem",
                  color: "var(--ink-300)",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                Not planning this trip? Start a new one.
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="home-hero-headline-block">
              <h1
                className="home-hero-headline"
                style={{
                  fontFamily: "var(--font-display)",
                  // See the hasTrip h1's identical comment above.
                  fontWeight: 700,
                  color: "var(--fg-on-ink)",
                  lineHeight: 1,
                  letterSpacing: "-0.01em",
                  margin: 0,
                }}
              >
                Where to?
              </h1>
              <p className="text-sm leading-relaxed mt-4 max-w-md" style={{ color: "var(--silk-500)" }}>
                Give us a place and we&apos;ll turn it into a plan — neighborhoods, food, a route that actually flows.
              </p>
            </div>
            <div className="home-hero-bottom-block">
              <div style={{ position: "relative" }}>
                <div
                  className="flex items-center gap-2 px-4 mb-3.5"
                  style={{
                    height: "56px",
                    borderRadius: "10px",
                    background: "rgba(238,231,214,0.08)",
                    border: "1px solid rgba(238,231,214,0.16)",
                  }}
                >
                  <Search size={18} style={{ color: "var(--ink-300)", flexShrink: 0 }} aria-hidden="true" />
                  <input
                    value={destinationName}
                    onChange={(e) => {
                      setDestinationName(e.target.value);
                      setSelectedDestination(null);
                    }}
                    onFocus={() => {
                      if (suggestions.length > 0) setSuggestionsOpen(true);
                    }}
                    onBlur={() => {
                      // Delay so a click on a suggestion registers first.
                      setTimeout(() => setSuggestionsOpen(false), 150);
                    }}
                    placeholder='Try "Marrakech", "Lisbon", "Osaka"…'
                    autoComplete="off"
                    aria-label="Search for a destination"
                    aria-expanded={suggestionsOpen}
                    aria-autocomplete="list"
                    style={{
                      flex: 1,
                      minWidth: 0,
                      background: "transparent",
                      border: "none",
                      outline: "none",
                      color: "var(--fg-on-ink)",
                      fontSize: "0.9rem",
                    }}
                  />
                </div>

                {suggestionsOpen && suggestions.length > 0 && (
                  <ul
                    role="listbox"
                    aria-label="Matching destinations"
                    style={{
                      position: "absolute",
                      bottom: "100%",
                      left: 0,
                      right: 0,
                      marginBottom: "4px",
                      background: "var(--ink-800)",
                      border: "1px solid rgba(238,231,214,0.16)",
                      borderRadius: "10px",
                      zIndex: 30,
                      maxHeight: "200px",
                      overflowY: "auto",
                      listStyle: "none",
                      margin: "0 0 4px 0",
                      padding: "4px",
                    }}
                  >
                    {suggestions.map((s) => (
                      <li key={s.id}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={selectedDestination?.id === s.id}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            setSelectedDestination(s);
                            setDestinationName(s.name);
                            setSuggestions([]);
                            setSuggestionsOpen(false);
                          }}
                          className="w-full text-left"
                          style={{
                            display: "block",
                            padding: "8px 10px",
                            borderRadius: "6px",
                            background: "transparent",
                            border: "none",
                            cursor: "pointer",
                            color: "var(--fg-on-ink)",
                            fontSize: "0.875rem",
                          }}
                        >
                          {s.name}
                          {s.country && <span style={{ color: "var(--ink-300)" }}> · {s.country}</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <Button variant="primary" size="lg" className="w-full" onClick={handleStartNewTrip}>
                Start a new trip
              </Button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
