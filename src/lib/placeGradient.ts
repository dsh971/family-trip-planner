// Deterministic fallback thumbnail gradient for place cards that have no
// Google Places photo (U4, plan 2026-08-23-002). Same input string always
// maps to the same gradient — this matters because a single place is
// rendered across four different pages (Neighborhoods, Discovery, Decisions,
// Itinerary) and a randomly-chosen gradient would make the same place look
// like four different places depending on which page you're on.
//
// Palette is loosely inspired by the recovered Hybrid mockups' own
// placeholder gradients (warm amber tones sliding into deeper earthy/sage
// tones), not an exact oklch match — this app doesn't otherwise use those
// mockups' literal color values.
const GRADIENT_PALETTE: readonly string[] = [
  "linear-gradient(150deg, oklch(70% 0.09 55), oklch(42% 0.08 30))",
  "linear-gradient(150deg, oklch(72% 0.08 95), oklch(45% 0.07 60))",
  "linear-gradient(150deg, oklch(68% 0.07 140), oklch(40% 0.06 150))",
  "linear-gradient(150deg, oklch(70% 0.06 170), oklch(42% 0.05 165))",
  "linear-gradient(150deg, oklch(66% 0.08 40), oklch(38% 0.07 145))",
  "linear-gradient(150deg, oklch(74% 0.05 85), oklch(46% 0.06 110))",
];

// Simple, fast, deterministic string hash (djb2 variant). Doesn't need to be
// cryptographically strong — just stable and reasonably well-distributed
// across the small fixed palette above.
function hashString(input: string): number {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return Math.abs(hash);
}

// Returns a CSS `linear-gradient(...)` string for use as a `background`
// value. `seed` should be a place's `placeId` (preferred, stable identity)
// or `name` (fallback when placeId isn't available at a given call site).
// A missing/empty seed falls back to a fixed palette entry rather than
// throwing or returning an empty string.
export function getPlaceGradient(seed: string | null | undefined): string {
  const key = seed && seed.length > 0 ? seed : "__no-place-id__";
  const index = hashString(key) % GRADIENT_PALETTE.length;
  return GRADIENT_PALETTE[index]!;
}
