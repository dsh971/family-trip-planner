"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "@/components/providers/ThemeProvider";
import { Button } from "@sumiui/react";
import { Moon, Sun } from "lucide-react";

type Step = "home" | "profile" | "area" | "discover" | "plan";

interface TabDef {
  id: Step;
  label: string;
  // Path segment(s) that mark this tab active for the current pathname.
  // "discover" lists two: decisions/page.tsx and discovery/page.tsx both
  // pass currentStep="discover" to StepProgress (see that component), so
  // both routes should light up the same "Discover" tab here.
  matches: string[];
  // "home"'s match ("/") is a substring of every path — needs exact
  // equality instead of the .includes() check every other tab uses.
  exact?: boolean;
}

// Reuses StepProgress's Profile/Area/Discover/Plan naming and route mapping
// (src/components/ui/StepProgress.tsx) rather than inventing new labels —
// per plan 2026-08-23-002-feat-hybrid-design-fidelity-gaps, U2. "Home" was
// missing from that unit's tab list entirely (StepProgress has no Home
// step, since it's a trip-progress indicator, not a global nav) — added
// per WebNav.dc.html's actual tab order (Home first), discovered missing
// only once a user pointed out there was no way back to Home from the
// desktop nav.
const TABS: TabDef[] = [
  { id: "home", label: "Home", matches: ["/"], exact: true },
  { id: "profile", label: "Profile", matches: ["/profile"] },
  { id: "area", label: "Area", matches: ["/neighborhoods"] },
  { id: "discover", label: "Discover", matches: ["/discovery", "/decisions"] },
  { id: "plan", label: "Plan", matches: ["/itinerary"] },
];

function tabHref(id: Step, tripId?: string): string | undefined {
  if (id === "home") return "/";
  if (!tripId) {
    // Pre-trip (no tripId yet): only "Profile" has a valid destination
    // (the standalone /profile create-trip route) — Area/Discover/Plan
    // don't exist until a trip is created, same gating StepProgress applies
    // via its `isDone && tripId` check.
    return id === "profile" ? "/profile" : undefined;
  }
  switch (id) {
    case "profile": return `/trip/${tripId}/profile`;
    case "area": return `/trip/${tripId}/neighborhoods`;
    case "discover": return `/trip/${tripId}/discovery`;
    case "plan": return `/trip/${tripId}/itinerary`;
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
        <nav className="flex items-center gap-1" aria-label="Trip planning steps">
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
