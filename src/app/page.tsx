"use client";

import Link from "next/link";
import { Button } from "@sumiui/react";

export default function Home() {
  return (
    <main
      className="min-h-screen flex flex-col items-center justify-center p-6 text-center relative overflow-hidden"
      style={{
        background: "linear-gradient(160deg, var(--bg-0) 0%, color-mix(in srgb, var(--accent) 20%, var(--bg-0)) 100%)",
      }}
    >
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

      <div
        className="absolute bottom-8 left-0 right-0 flex justify-center gap-8 text-xs"
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
