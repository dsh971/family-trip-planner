"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "@/components/providers/ThemeProvider";
import { Button } from "@sumiui/react";
import { Moon, Sun } from "lucide-react";

type Step = "home" | "trip" | "discover" | "saved" | "itinerary";

interface TabDef {
  id: Step;
  label: string;
  // Path segment(s) that mark this tab active for the current pathname.
  matches: string[];
  // "home"'s match ("/") is a substring of every path — needs exact
  // equality instead of the .includes() check every other tab uses.
  exact?: boolean;
}

// CORRECTED (this unit's first build got this wrong): the four non-Home
// tabs were originally borrowed from a since-deleted StepProgress
// component's Profile/Area/Discover/Plan naming — a *different*, 4-step
// trip-progress breadcrumb model, not WebNav's actual nav structure.
// Checking the recovered WebNav.dc.html mockup directly (its own
// `data-dc-script` props declare
// options:["home","trip","discover","saved","itinerary"]) shows a 5-tab
// model that doesn't line up 1:1: no separate "Area" tab exists at all —
// Web-Neighborhoods.dc.html's own `active="trip"` confirms neighborhood
// picking lights up "Trip setup", the same tab as /profile — and Discovery
// and Decisions are two SEPARATE tabs ("Discover" / "Saved"), not one
// merged tab, per Web-Discovery.dc.html's `active="discover"` vs
// Web-Decisions.dc.html's `active="saved"`. StepProgress itself was
// removed from every page (not just relabeled) once this correction made
// clear it had no basis in any mockup and was fully redundant with what
// WebNav/BottomNav's own active-tab highlighting already provide.
const TABS: TabDef[] = [
  { id: "home", label: "Home", matches: ["/"], exact: true },
  { id: "trip", label: "Trip setup", matches: ["/profile", "/neighborhoods"] },
  { id: "discover", label: "Discover", matches: ["/discovery"] },
  { id: "saved", label: "Saved", matches: ["/decisions"] },
  { id: "itinerary", label: "Itinerary", matches: ["/itinerary"] },
];

function tabHref(id: Step, tripId?: string): string | undefined {
  if (id === "home") return "/";
  if (!tripId) {
    // Pre-trip (no tripId yet): only "Trip setup" has a valid destination
    // (the standalone /profile create-trip route) — the rest don't exist
    // until a trip is created.
    return id === "trip" ? "/profile" : undefined;
  }
  switch (id) {
    // Trip setup covers both /profile and /neighborhoods (per the mockup),
    // but only has one link target — the profile edit page, since that's
    // the more durable "come back and adjust trip setup" destination;
    // neighborhood re-selection isn't something the top nav needs to
    // shortcut to directly.
    case "trip": return `/trip/${tripId}/profile`;
    case "discover": return `/trip/${tripId}/discovery`;
    case "saved": return `/trip/${tripId}/decisions`;
    case "itinerary": return `/trip/${tripId}/itinerary`;
  }
}

export interface WebNavProps {
  tripId?: string;
  // Trip-context chip (destination name + trip dates). Optional and
  // caller-supplied rather than fetched inside this component — the parent
  // trip layout already resolves this once per navigation and passes it
  // down, so WebNav stays a plain presentational component with no data
  // fetching of its own.
  tripName?: string;
  tripDates?: string;
}

export function WebNav({ tripId, tripName, tripDates }: WebNavProps) {
  const { theme, toggle } = useTheme();
  const pathname = usePathname();

  return (
    // Desktop-only persistent top nav (>=1024px) — see globals.css's
    // `.web-nav` rule for the show/hide breakpoint (mirrors
    // .home-hero-pins-mobile/-desktop's technique: default display:none,
    // min-width media query flips it to display:flex). AppHeader/BottomNav
    // carry the mirror-image `.mobile-chrome` class so exactly one of the
    // two chrome sets is visible per breakpoint.
    <header
      className="web-nav fixed top-0 left-0 z-50 h-16 flex items-center justify-between px-8 border-b"
      style={{ right: 0, background: "var(--bg-card, var(--bg-1))", borderColor: "var(--line-1)" }}
    >
      <div className="flex items-center gap-8">
        <span
          className="text-lg font-semibold tracking-tight"
          style={{ fontFamily: "var(--font-display)", color: "var(--fg-1)" }}
        >
          Viridian
        </span>
        <nav className="flex items-center gap-1" aria-label="Primary">
          {TABS.map((tab) => {
            const active = tab.exact
              ? tab.matches.includes(pathname)
              : tab.matches.some((m) => pathname.includes(m));
            const href = tabHref(tab.id, tripId);
            const textStyle = {
              color: active ? "var(--accent)" : "var(--fg-3)",
              fontWeight: active ? 600 : 500,
            };
            return href ? (
              <Link
                key={tab.id}
                href={href}
                className="px-3 py-2 text-sm rounded-md transition-colors"
                style={textStyle}
              >
                {tab.label}
              </Link>
            ) : (
              <span
                key={tab.id}
                className="px-3 py-2 text-sm"
                style={{ ...textStyle, color: "var(--fg-3)", opacity: 0.5, cursor: "default" }}
                aria-disabled="true"
              >
                {tab.label}
              </span>
            );
          })}
        </nav>
      </div>

      <div className="flex items-center gap-4">
        {tripName && (
          <div
            className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-full"
            style={{ background: "var(--bg-2)", color: "var(--fg-2)" }}
            data-testid="trip-context-chip"
          >
            <span style={{ fontWeight: 600, color: "var(--fg-1)" }}>{tripName}</span>
            {tripDates && <span>· {tripDates}</span>}
          </div>
        )}
        <Button variant="ghost" size="sm" onClick={toggle} aria-label="Toggle theme">
          {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </Button>
      </div>
    </header>
  );
}
