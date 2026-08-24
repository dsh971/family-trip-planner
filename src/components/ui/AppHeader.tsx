"use client";

import { usePathname } from "next/navigation";
import { useTheme } from "@/components/providers/ThemeProvider";
import { Button } from "@sumiui/react";
import { Moon, Sun } from "lucide-react";

export function AppHeader() {
  const { theme, toggle } = useTheme();
  const pathname = usePathname();

  // Home (Hybrid design direction) is the app's one full-bleed dark-hero
  // moment, deliberately built with "minimal competing chrome" — the global
  // light-surface AppHeader bar doesn't belong on top of it. Every other
  // route keeps the persistent header.
  if (pathname === "/") return null;

  return (
    // Design-fidelity fix (2026-08-23): `right-0` produces no CSS rule
    // anywhere in this project (verified against the compiled stylesheet,
    // same class of bug as `min-h-screen` — `.right-4` exists but `.right-0`
    // doesn't). left:0 alone doesn't constrain width, so this header was
    // silently collapsing to its content's shrink-to-fit width instead of
    // spanning the viewport on every non-Home page. Inline style per this
    // project's own documented fallback for exactly this failure mode.
    <header className="fixed top-0 left-0 z-50 h-11 flex items-center justify-between px-4 border-b"
      style={{ right: 0, background: "var(--bg-card, var(--bg-1))", borderColor: "var(--line-1)" }}
    >
      <span
        className="text-lg font-semibold tracking-tight"
        style={{ fontFamily: "var(--font-display)", color: "var(--fg-1)" }}
      >
        Trip Planner
      </span>
      <Button variant="ghost" size="sm" onClick={toggle} aria-label="Toggle theme">
        {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
      </Button>
    </header>
  );
}
