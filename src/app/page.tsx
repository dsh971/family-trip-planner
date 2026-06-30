"use client";

import Link from "next/link";
import { Button } from "@sumiui/react";

export default function Home() {
  return (
    <main
      className="min-h-screen flex flex-col relative overflow-hidden"
      style={{
        background: "linear-gradient(160deg, var(--bg-0) 0%, color-mix(in srgb, var(--accent) 20%, var(--bg-0)) 100%)",
      }}
    >
      {/* Push content below fixed AppHeader (h-11 = 44px) */}
      <div className="h-11 shrink-0" aria-hidden="true" />

      {/* Vertically centered hero content */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 pb-6 text-center">
        <div className="relative z-10 flex flex-col items-center gap-4 max-w-sm w-full">
          <p
            className="text-xs font-semibold uppercase tracking-widest"
            style={{ color: "var(--accent)", letterSpacing: "0.2em" }}
          >
            Tokyo, Japan
          </p>

          <h1
            className="text-6xl font-bold tracking-tight leading-none"
            style={{ fontFamily: "var(--font-display)", color: "var(--fg-1)" }}
          >
            FamTrip
            <br />
            Planner
          </h1>

          <p className="text-base mt-1" style={{ color: "var(--fg-2)" }}>
            Plan your perfect Tokyo family adventure — neighborhoods, food, activities, all in one place.
          </p>

          <Button variant="primary" size="lg" asChild className="mt-4 w-full">
            <Link href="/profile">Start planning →</Link>
          </Button>
        </div>
      </div>

      {/* Feature footer */}
      <div
        className="shrink-0 pb-8 flex justify-center gap-8 text-xs"
        style={{ color: "var(--fg-3)" }}
      >
        <span>Neighborhoods</span>
        <span style={{ color: "var(--accent)" }}>·</span>
        <span>Discover</span>
        <span style={{ color: "var(--accent)" }}>·</span>
        <span>Itinerary</span>
      </div>
    </main>
  );
}
