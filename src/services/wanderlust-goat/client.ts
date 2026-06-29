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
function buildAnchorName(neighborhoodName: string, city = "Tokyo", country = "Japan"): string {
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
// Uses named anchor so WG resolves to JP country and fires Tabelog/Hotpepper validators.
export async function discoverGoat(
  neighborhoodName: string,
  category: string,
  radiusMeters: number
): Promise<WGGoatResult> {
  const anchor = buildAnchorName(neighborhoodName);
  const flagsKey = `cat:${category},r:${radiusMeters}`;
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
    "--select",
    "name,lat,lng,address,walking_minutes,score,sources,evidence,why,business_status,google_maps_uri",
    "--radius",
    String(radiusMeters),
    "--category",
    category,
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
