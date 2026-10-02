"use client";

import { useEffect, useRef } from "react";
import { ExternalLink } from "lucide-react";

// Replaces the plain "View photos" external link (U7, plan
// 2026-09-12-001-fix-design-audit-bugs-plan.md) with an in-app peek,
// modeled on Wikipedia's Page Previews and validated against Google Maps',
// Apple Maps', and Wanderlog's own place-preview surfaces (U9, same plan).
// Deliberately omits rating/review count (already visible on the card this
// peek is anchored to — Google's own map-pin peek drops the same fields
// for the same reason) and a second action button (Discovery's and
// Decisions' cards already expose Add/Skip and Remove directly).
export interface PlacePeekProps {
  name: string;
  category: "eat" | "visit";
  priceLevel: number | null;
  description: string | null;
  placeGoogleId: string;
  onClose: () => void;
}

export default function PlacePeek({
  name,
  category,
  priceLevel,
  description,
  placeGoogleId,
  onClose,
}: PlacePeekProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handlePointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={`Quick preview of ${name}`}
      style={{
        position: "absolute",
        zIndex: 20,
        top: "calc(100% + 8px)",
        left: 0,
        width: "280px",
        background: "var(--bg-0)",
        border: "1px solid var(--line-1)",
        borderRadius: "14px",
        boxShadow: "0 12px 32px rgba(28,27,26,0.16), 0 4px 12px rgba(28,27,26,0.08)",
        padding: "14px",
      }}
    >
      <p
        style={{
          fontFamily: "var(--font-display)",
          fontWeight: 600,
          fontSize: "1rem",
          margin: "0 0 6px",
          color: "var(--fg-1)",
        }}
      >
        {name}
      </p>
      <div
        className="flex items-center gap-1.5 flex-wrap"
        style={{ marginBottom: description ? "8px" : "12px" }}
      >
        <span
          className="text-xs font-semibold rounded-full px-2 py-0.5"
          style={{ background: "var(--bg-2)", color: "var(--fg-2)" }}
        >
          {category === "eat" ? "Restaurant" : "Attraction"}
        </span>
        {priceLevel !== null && (
          <span
            className="text-xs font-semibold rounded-full px-2 py-0.5"
            style={{ background: "var(--bg-2)", color: "var(--fg-2)" }}
          >
            {"$".repeat(priceLevel)}
          </span>
        )}
        {/* Hours are unconditionally "unknown": opening_hours is empty for
            every place in this app's data today, a separate, already-
            documented enrichment bug. Shown honestly rather than omitted or
            fabricated — see U9's Approach for the field-by-field reasoning. */}
        <span
          className="text-xs italic rounded-full px-2 py-0.5"
          style={{ background: "var(--bg-2)", color: "var(--fg-3)" }}
        >
          Hours unknown
        </span>
      </div>
      {description && (
        <p
          className="text-xs"
          style={{ color: "var(--fg-2)", lineHeight: 1.45, margin: "0 0 12px" }}
        >
          {description}
        </p>
      )}
      <a
        href={`https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeGoogleId)}`}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center justify-center gap-1.5 rounded-xl text-sm font-semibold w-full"
        style={{ padding: "9px 12px", background: "var(--accent)", color: "var(--fg-on-malachite)" }}
      >
        <ExternalLink size={13} aria-hidden="true" />
        Open in Google Maps
      </a>
    </div>
  );
}
