"use client";

import Link from "next/link";
import { Button } from "@sumiui/react";

export default function Home() {
  return (
    <main
      className="min-h-screen flex flex-col relative overflow-hidden"
      style={{
        // Bold, full-bleed editorial hero — the one place in the app that
        // earns the dark ink->malachite treatment (Hybrid direction, U8).
        // Every other page stays on the warm silk surfaces.
        background: "linear-gradient(160deg, var(--ink-900) 0%, var(--malachite-900) 55%, var(--malachite-800) 100%)",
      }}
    >
      {/* Push content below fixed AppHeader (h-11 = 44px) */}
      <div className="h-11 shrink-0" aria-hidden="true" />

      {/* Vertically centered hero content */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 pb-6 text-center">
        <div className="relative z-10 flex flex-col items-center gap-4 max-w-sm w-full">
          <p
            className="text-xs font-semibold uppercase tracking-widest"
            style={{ color: "var(--malachite-300)", letterSpacing: "0.2em" }}
          >
            Family Trip Planning
          </p>

          <h1
            className="text-6xl font-bold tracking-tight leading-none"
            style={{ fontFamily: "var(--font-display)", color: "var(--fg-on-ink)" }}
          >
            FamTrip
            <br />
            Planner
          </h1>

          <p className="text-base mt-1" style={{ color: "var(--silk-500)" }}>
            Plan your perfect family adventure, anywhere — neighborhoods, food, activities, all in one place.
          </p>

          <Button variant="primary" size="lg" asChild className="mt-4 w-full">
            <Link href="/profile">Start planning →</Link>
          </Button>
        </div>
      </div>

      {/* Feature footer */}
      <div
        className="shrink-0 pb-8 flex justify-center gap-8 text-xs"
        style={{ color: "var(--silk-600)" }}
      >
        <span>Neighborhoods</span>
        <span style={{ color: "var(--malachite-400)" }}>·</span>
        <span>Discover</span>
        <span style={{ color: "var(--malachite-400)" }}>·</span>
        <span>Itinerary</span>
      </div>
    </main>
  );
}
