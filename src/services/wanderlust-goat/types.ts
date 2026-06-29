// Types derived from live trial output (2026-06-28) — see plan KTD-B / U5

export interface WGAnchor {
  query: string;
  lat: number;
  lng: number;
  country: string;
  display: string;
  city: string;
}

export interface WGScore {
  total: number;
  google_base: number;
  locale_boost: number;
  notability_boost: number;
  reddit_boost: number;
  criteria_match: number;
}

export interface WGPlace {
  name: string;
  lat: number;
  lng: number;
  address: string;
  walking_minutes: number;
  score: WGScore;
  sources: string[];
  evidence: string | null;
  why: string;
  business_status: string;
  google_maps_uri: string;
}

export interface WGTrace {
  Region: string;
  SeedCount: number;
  StageHits: number;
  StubsSkipped: string[];
  Errors: string[];
}

export interface WGGoatResult {
  anchor: WGAnchor;
  results: WGPlace[];
  trace: WGTrace;
}

export interface WGRouteViewResult {
  from: WGAnchor;
  to: WGAnchor;
  buffer_meters: number;
  distance_meters: number;
  walking_minutes: number;
  // null until sync-city hydrates local OSM store
  along_route: null;
  note: string;
}

export interface WGCrossoverResult {
  anchor: WGAnchor;
  radius_meters: number;
  pair: [string, string];
  pair_distance_meters: number;
  // null until sync-city hydrates local OSM store
  pairs: null;
  note: string;
}

export type WGResult = WGGoatResult | WGRouteViewResult | WGCrossoverResult;

export class WGUnavailableError extends Error {
  constructor() {
    super("Wanderlust GOAT CLI is not installed or not on PATH");
    this.name = "WGUnavailableError";
  }
}

export class WGCommandError extends Error {
  constructor(
    public readonly command: string,
    public readonly exitCode: number,
    public readonly stderr: string
  ) {
    super(`Wanderlust GOAT '${command}' exited with code ${exitCode}: ${stderr}`);
    this.name = "WGCommandError";
  }
}
