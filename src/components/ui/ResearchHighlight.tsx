"use client";

// U7 (plan 2026-08-20-011): small wait-state card shown alongside skeletons
// while a destination/neighborhood research run is actively in progress
// (status "researching") — gives the traveler something to read instead of
// a blank skeleton bank. Sumi-bare + inline CSS-custom-property styling,
// matching this app's current (pre-U8) visual convention.

export interface ResearchHighlightProps {
  text: string;
  /** Small eyebrow label above the blurb, e.g. "While we look around…". */
  label?: string;
}

export default function ResearchHighlight({
  text,
  label = "While we look around…",
}: ResearchHighlightProps) {
  return (
    <div
      role="status"
      className="rounded-lg p-4"
      style={{ background: "var(--bg-1)", border: "1px solid var(--line-1)" }}
    >
      <p
        className="text-xs font-medium mb-1 uppercase tracking-wide"
        style={{ color: "var(--fg-3)", fontFamily: "var(--font-body)" }}
      >
        {label}
      </p>
      <p
        className="text-sm italic leading-relaxed"
        style={{ color: "var(--fg-2)", fontFamily: "var(--font-display)" }}
      >
        {text}
      </p>
    </div>
  );
}
