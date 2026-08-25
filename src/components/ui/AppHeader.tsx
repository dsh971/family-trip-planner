"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "@/components/providers/ThemeProvider";
import { Button } from "@sumiui/react";
import { ArrowLeft, Moon, Sun } from "lucide-react";

// Deterministic "up one stage" mapping, mirroring the mockups' own
// per-screen circular back-button (every Hybrid-*.dc.html has one,
// top-left) — added after removing StepProgress left mobile with no way
// back to Trip setup/Neighborhoods at all (BottomNav only ever covered
// Discover/My List/Itinerary). A fixed mapping is used instead of browser
// history (`router.back()`) because history is unpredictable on a fresh
// tab, a refresh, or a deep link — this always goes to the same place
// regardless of how the traveler arrived.
function backHref(pathname: string, tripId: string | undefined): string | null {
  if (pathname === "/profile") return "/";
  if (!tripId) return null;
  if (pathname.endsWith("/profile")) return "/";
  if (pathname.endsWith("/neighborhoods")) return `/trip/${tripId}/profile`;
  if (pathname.endsWith("/discovery")) return `/trip/${tripId}/neighborhoods`;
  if (pathname.endsWith("/decisions")) return `/trip/${tripId}/discovery`;
  if (pathname.endsWith("/itinerary")) return `/trip/${tripId}/decisions`;
  return null;
}

export function AppHeader() {
  const { theme, toggle } = useTheme();
  const pathname = usePathname();

  // Home (Hybrid design direction) is the app's one full-bleed dark-hero
  // moment, deliberately built with "minimal competing chrome" — the global
  // light-surface AppHeader bar doesn't belong on top of it. Every other
  // route keeps the persistent header.
  if (pathname === "/") return null;

  // tripId isn't available via useParams() here (AppHeader renders outside
  // the /trip/[tripId] segment, from the root Providers tree) — pull it
  // from the pathname directly instead of adding a route-param dependency.
  const tripMatch = pathname.match(/^\/trip\/(\d+)\//);
  const tripId = tripMatch?.[1];
  const back = backHref(pathname, tripId);

  return (
    // Design-fidelity fix (2026-08-23): `right-0` produces no CSS rule
    // anywhere in this project (verified against the compiled stylesheet,
    // same class of bug as `min-h-screen` — `.right-4` exists but `.right-0`
    // doesn't). left:0 alone doesn't constrain width, so this header was
    // silently collapsing to its content's shrink-to-fit width instead of
    // spanning the viewport on every non-Home page. Inline style per this
    // project's own documented fallback for exactly this failure mode.
    // Desktop nav shell (U2, 2026-08-23-002): hidden at >=1024px via the
    // `mobile-chrome` class (globals.css) — WebNav takes over at that
    // breakpoint. Still returns null on Home above, unrelated to this.
    <header className="mobile-chrome fixed top-0 left-0 z-50 h-11 flex items-center justify-between px-4 border-b"
      style={{ right: 0, background: "var(--bg-card, var(--bg-1))", borderColor: "var(--line-1)" }}
    >
      <div className="flex items-center gap-2">
        {back && (
          <Link
            href={back}
            aria-label="Back"
            className="flex items-center justify-center rounded-full"
            style={{
              width: "30px",
              height: "30px",
              marginLeft: "-6px",
              color: "var(--fg-1)",
              background: "var(--bg-2)",
            }}
          >
            <ArrowLeft size={16} />
          </Link>
        )}
        <span
          className="text-lg font-semibold tracking-tight"
          style={{ fontFamily: "var(--font-display)", color: "var(--fg-1)" }}
        >
          Viridian
        </span>
      </div>
      <Button variant="ghost" size="sm" onClick={toggle} aria-label="Toggle theme">
        {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
      </Button>
    </header>
  );
}
