"use client";

import { useTheme } from "@/components/providers/ThemeProvider";
import { Button } from "@sumiui/react";
import { Moon, Sun } from "lucide-react";

export function AppHeader() {
  const { theme, toggle } = useTheme();

  return (
    <header className="fixed top-0 left-0 right-0 z-50 h-11 flex items-center justify-between px-4 border-b"
      style={{ background: "var(--bg-card, var(--bg-1))", borderColor: "var(--line-1)" }}
    >
      <span
        className="text-lg font-semibold tracking-tight"
        style={{ fontFamily: "var(--font-display)", color: "var(--fg-1)" }}
      >
        FamTripPlanner
      </span>
      <Button variant="ghost" size="sm" onClick={toggle} aria-label="Toggle theme">
        {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
      </Button>
    </header>
  );
}
