// Worth-the-detour routing check (KTD-E, U7).
// Uses WG route-view to compute actual transit time from the lodging anchor
// (or neighborhood centroid when no lodging is set — KTD-H fallback) to the
// candidate place, then applies the family pacing budget to decide viability.

import { routeView } from "@/services/wanderlust-goat/client";
import { WGUnavailableError } from "@/services/wanderlust-goat/types";

export interface DetourCheckInput {
  fromName: string; // named anchor — lodging address or neighborhood name
  toName: string;   // place name + neighborhood context e.g. "TeamLab, Toyosu, Tokyo, Japan"
  pacingBudgetMinutes: number; // max acceptable one-way transit time for this family
}

export interface DetourResult {
  viable: boolean;
  distanceMeters: number | null;
  walkingMinutes: number | null;
  note: string | null;
  wgAvailable: boolean;
}

// Threshold: if WG returns a route but walking time exceeds this AND pacing budget,
// flag the detour as not viable.
const HARD_WALKING_CAP_MINUTES = 60;

// Check whether a worth-the-detour candidate is actually reachable within
// the family's pacing budget. Gracefully degrades when WG is unavailable.
export async function checkDetourViability(
  input: DetourCheckInput
): Promise<DetourResult> {
  try {
    const result = await routeView(input.fromName, input.toName);

    const walkingMinutes = result.walking_minutes;
    const distanceMeters = result.distance_meters;

    if (walkingMinutes === null) {
      // WG returned a route but couldn't compute walking time (cross-island, ferry, etc.)
      return {
        viable: false,
        distanceMeters,
        walkingMinutes: null,
        note: result.note,
        wgAvailable: true,
      };
    }

    const viable =
      walkingMinutes <= input.pacingBudgetMinutes &&
      walkingMinutes <= HARD_WALKING_CAP_MINUTES;

    return {
      viable,
      distanceMeters,
      walkingMinutes,
      note: result.note,
      wgAvailable: true,
    };
  } catch (err) {
    if (err instanceof WGUnavailableError) {
      // WG not available — assume viable and let user decide (graceful degradation)
      return {
        viable: true,
        distanceMeters: null,
        walkingMinutes: null,
        note: "Routing unavailable — detour not verified",
        wgAvailable: false,
      };
    }
    throw err;
  }
}

// Build a canonical named anchor string for a neighborhood centroid fallback (KTD-H).
// This triggers WG's JP-specific validators when `country` resolves to Japan.
export function buildNeighborhoodAnchor(neighborhoodName: string, city = "Tokyo", country = "Japan"): string {
  return `${neighborhoodName}, ${city}, ${country}`;
}

// Derive pacingBudgetMinutes from the family profile's pacing windows.
// Uses the first afternoon (post-nap) or default 45-minute transit budget.
export function derivePacingBudget(
  pacingWindows: Array<{ name: string; startTime: string; endTime: string }>
): number {
  const nap = pacingWindows.find((w) => w.name === "nap");
  if (!nap) return 45;

  // Budget = time between nap end and bedtime / 4 (rough heuristic: one big excursion)
  const bedtime = pacingWindows.find((w) => w.name === "bedtime");
  if (!bedtime) return 45;

  const [napEndH = 0, napEndM = 0] = nap.endTime.split(":").map(Number);
  const [bedH = 0, bedM = 0] = bedtime.startTime.split(":").map(Number);
  const freeMinutes = (bedH * 60 + bedM) - (napEndH * 60 + napEndM);
  return Math.max(20, Math.min(60, Math.floor(freeMinutes / 4)));
}
