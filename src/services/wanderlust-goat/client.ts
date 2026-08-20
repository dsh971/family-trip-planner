import { execFileAsync } from "./executor";
import { which } from "./which";
import {
  cacheKey,
  getFromCache,
  setInCache,
} from "./cache";
import {
  WGGoatResult,
  WGRouteViewResult,
  WGCrossoverResult,
  WGUnavailableError,
  WGCommandError,
} from "./types";

const WG_BINARY = "wanderlust-goat-pp-cli";

// Named anchor required — raw lat/lng falls back to country:"*" (English-only sources).
// U5 resolves each neighborhood centroid to a named string like "Kichijoji, Tokyo, Japan".
// city/country come from the trip's actual destinations row (plan 2026-08-20-011 U2) —
// no default; every caller must supply the real destination instead of silently getting
// Tokyo/Japan for destinations that aren't Tokyo.
function buildAnchorName(neighborhoodName: string, city: string, country: string): string {
  return `${neighborhoodName}, ${city}, ${country}`;
}

let _available: boolean | null = null;

async function isAvailable(): Promise<boolean> {
  if (_available !== null) return _available;
  _available = await which(WG_BINARY);
  return _available;
}

// Resets the cached availability flag. Only intended for use in tests.
export function _resetAvailabilityForTesting(): void {
  _available = null;
}

async function runCommand(args: string[]): Promise<string> {
  const available = await isAvailable();
  if (!available) throw new WGUnavailableError();

  const { stdout, stderr } = await execFileAsync(WG_BINARY, args).catch((err: Error & { code?: number; stderr?: string }) => {
    const exitCode = err.code ?? 1;
    const errMsg = err.stderr ?? err.message;
    throw new WGCommandError(args[0] ?? "unknown", exitCode, errMsg);
  });

  // Warn on non-empty stderr but don't throw — WG uses stderr for trace info
  if (stderr && stderr.trim()) {
    console.warn(`[WG] stderr for ${args[0]}:`, stderr.trim());
  }

  return stdout;
}

function parseJson<T>(raw: string, command: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new WGCommandError(command, 0, `Malformed JSON output: ${raw.slice(0, 200)}`);
  }
}

// goat — discovery with cross-source validation (KTD-B).
// Uses named anchor so WG resolves to the destination's actual country and fires its
// locale-appropriate validators (e.g. Tabelog/Hotpepper for Japan) — city/country must
// be the trip's real destination (destinations.name/country), not a hardcoded default.
export async function discoverGoat(
  neighborhoodName: string,
  category: string,
  radiusMeters: number,
  city: string,
  country: string
): Promise<WGGoatResult> {
  const anchor = buildAnchorName(neighborhoodName, city, country);

  const walkingMinutes = Math.max(5, Math.round(radiusMeters / 80));

  let criteria: string;
  let type: string;
  if (category === "eat") {
    criteria = "family restaurants";
    type = "restaurant";
  } else if (category === "visit") {
    criteria = "family activities and attractions";
    type = "tourist_attraction";
  } else {
    criteria = category;
    type = category;
  }

  const flagsKey = `min:${walkingMinutes},criteria:${criteria},type:${type}`;
  const key = cacheKey("goat", anchor, flagsKey);

  const cached = getFromCache<WGGoatResult>(key);
  if (cached) return cached;

  const args = [
    "goat",
    anchor,
    "--json",
    "--no-input",
    "--no-color",
    "--yes",
    "--agent",
    "--minutes",
    String(walkingMinutes),
    "--criteria",
    criteria,
    "--type",
    type,
  ];

  const raw = await runCommand(args);
  const result = parseJson<WGGoatResult>(raw, "goat");
  setInCache(key, result);
  return result;
}

// route-view — walking route between two named places (in-cluster legs, KTD-B).
export async function routeView(
  fromName: string,
  toName: string
): Promise<WGRouteViewResult> {
  const key = cacheKey("route-view", fromName, toName);

  const cached = getFromCache<WGRouteViewResult>(key);
  if (cached) return cached;

  const args = [
    "route-view",
    fromName,
    toName,
    "--json",
    "--no-input",
    "--no-color",
    "--yes",
    "--agent",
  ];

  const raw = await runCommand(args);
  const result = parseJson<WGRouteViewResult>(raw, "route-view");
  setInCache(key, result);
  return result;
}

// crossover — checks if two places are within walking distance of the anchor (KTD-B).
export async function crossover(
  anchorName: string,
  radiusMeters: number,
  pair: [string, string]
): Promise<WGCrossoverResult> {
  const flagsKey = `r:${radiusMeters},pair:${pair.join("|")}`;
  const key = cacheKey("crossover", anchorName, flagsKey);

  const cached = getFromCache<WGCrossoverResult>(key);
  if (cached) return cached;

  const args = [
    "crossover",
    anchorName,
    pair[0],
    pair[1],
    "--json",
    "--no-input",
    "--no-color",
    "--yes",
    "--agent",
    "--radius",
    String(radiusMeters),
  ];

  const raw = await runCommand(args);
  const result = parseJson<WGCrossoverResult>(raw, "crossover");
  setInCache(key, result);
  return result;
}

// Checks WG availability via the `doctor` command.
export async function checkAvailability(): Promise<boolean> {
  return isAvailable();
}

// sync-city — hydrates WG's local per-city OSM/route-network data store
// (docs/plans/2026-06-15-001-feat-experience-curation-engine-plan.md KTD-J).
// Without this, route-view/crossover return null and goat falls back to
// English-only sources for that city (see WGRouteViewResult.along_route /
// WGCrossoverResult.pairs comments in ./types.ts).
//
// Historically this only ran once, unconditionally, for Tokyo at container
// startup (scripts/entrypoint.sh). Plan 2026-08-20-011 U5 makes it callable
// per-destination as the one-time first step of that destination's first
// neighborhood-discovery research pass (see src/app/api/destinations/[id]/research/route.ts) —
// callers are responsible for only invoking this when a destination's
// researchStatus is "not_started" (checked once, before markInProgress);
// this function itself has no memory of which cities it's already synced.
//
// Real invocation takes 2-5 minutes in production (plan Risks & Dependencies)
// — this is the one-time cost that lands on whoever triggers a city's first
// research pass. No caching here: this is a one-time side-effecting
// hydration step, not a queryable result with something to key a cache by.
//
// --no-input/--no-color/--yes mirror the non-interactive flags every other
// command in this file already passes (required now that this runs inside a
// live request handler, not an interactive startup script). --json/--agent
// are intentionally omitted — callers don't need structured output, just
// success/failure, and runCommand already surfaces failures as
// WGUnavailableError/WGCommandError like every other export here.
export async function syncCity(city: string, country: string): Promise<void> {
  const args = ["sync-city", city, "--country", country, "--no-input", "--no-color", "--yes"];
  await runCommand(args);
}
