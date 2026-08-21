// Neighborhood-discovery research pass (plan 2026-08-20-011 U5).
//
// Given a destination, produces two things:
//   1. A short destination-level highlight blurb — a side-output emitted
//      first by the SSE route (src/app/api/destinations/[id]/research/route.ts)
//      per the plan's highlight-first Key Technical Decision, so it's
//      available for the whole research wait, not just whatever's left of it.
//   2. A stream of neighborhood candidates, each carrying its own
//      "day in the life" preview — which doubles as a per-neighborhood
//      highlight for wait-state UI once a traveler drills into it.
//
// ---------------------------------------------------------------------------
// CONTENT-GENERATION SCOPE NOTE — read before extending this file.
// ---------------------------------------------------------------------------
// This codebase has no pre-existing service that discovers *new*
// neighborhoods for an arbitrary city. Before this plan, `neighborhoods`
// rows only ever came from static per-city seed JSON
// (src/data/{city}/neighborhoods.json), produced by a documented
// human-in-the-loop research pipeline (source-tiering, weighted mention
// counts, human review — see
// docs/plans/2026-06-15-001-feat-experience-curation-engine-plan.md U3).
// Rebuilding an equivalent editorially-sourced pipeline for *every* possible
// destination is out of scope for this unit — U5's actual deliverable is the
// pipeline *mechanism* (staged research, SSE streaming, incremental upsert,
// sync-city hydration), not a fully-built content-discovery algorithm (see
// this plan's U5 Approach section).
//
// What this file actually does: it calls Google Places Text Search — the
// same GOOGLE_PLACES_API_KEY-backed API already integrated in
// src/services/discovery/places.ts — with a "neighborhoods in {city},
// {country}" query to get REAL candidate names and centroid coordinates.
// This is a genuine, already-wired external dependency, not a fabricated
// one; the query shape mirrors places.ts's textSearchPlaces exactly (same
// endpoint, same env var, same graceful-empty-array-on-failure convention).
// It is intentionally NOT added to places.ts itself, to keep this unit's
// diff scoped to the files this plan unit lists.
//
// What's still a placeholder: familyFriendlinessScore and
// dayInTheLifePreview (vibeTagline/highlights/safetyNote/sampleBundle) are
// templated/derived, not sourced from the multi-tier editorial-consensus
// pipeline that produced the original Tokyo seed data (which required a
// human review pass). A future unit can swap the templated content in
// `buildPlaceholderPreview` below for a real content-generation pass
// without touching the pipeline shape (status tracking, streaming, upsert,
// sync-city) this unit built — that shape is what's load-bearing here.
// ---------------------------------------------------------------------------

export interface DiscoverableDestination {
  id: number;
  name: string;
  country: string;
}

export interface NeighborhoodPreview {
  vibeTagline?: string;
  highlights: string[];
  safetyNote: string;
  sampleBundle: string;
}

export interface NeighborhoodCandidate {
  name: string;
  centroidLat: number;
  centroidLng: number;
  walkingRadiusMeters: number;
  familyFriendlinessScore: number;
  dayInTheLifePreview: NeighborhoodPreview;
  sources: string[];
}

const DEFAULT_WALKING_RADIUS_METERS = 1200;
const MAX_NEIGHBORHOOD_CANDIDATES = 3;

// Neutral placeholder score (mid-scale, 0-100) — not derived from any real
// signal yet. See CONTENT-GENERATION SCOPE NOTE above.
const PLACEHOLDER_FAMILY_FRIENDLINESS_SCORE = 50;

// ---------------------------------------------------------------------------
// Destination-level highlight (side-output, emitted first)
// ---------------------------------------------------------------------------

// Deliberately simple/templated per this plan's Approach section ("this can
// be a simple templated/derived string for now, e.g. drawing on whatever
// destination info is available; don't over-build a content-generation
// system, this is scaffolding for later real content").
export function generateDestinationHighlight(destination: DiscoverableDestination): string {
  return (
    `Discovering ${destination.name}, ${destination.country} now — ` +
    `neighborhoods will appear below as each one resolves.`
  );
}

// ---------------------------------------------------------------------------
// Neighborhood candidate discovery
// ---------------------------------------------------------------------------

interface GeocodedPlace {
  name: string;
  lat: number;
  lng: number;
}

interface TextSearchResponseItem {
  name: string;
  geometry: { location: { lat: number; lng: number } };
}

interface TextSearchResponse {
  status: string;
  results?: TextSearchResponseItem[];
}

// Mirrors src/services/discovery/places.ts's textSearchPlaces: same
// endpoint, same env var, same "warn and return [] on any failure" fallback
// (no API key configured, non-200 response, network error, zero results —
// none of these are treated as a hard failure; they just mean this
// destination gets zero real candidates from this source).
async function searchNeighborhoodCandidates(
  city: string,
  country: string
): Promise<GeocodedPlace[]> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    console.warn(
      "[NeighborhoodDiscovery] GOOGLE_PLACES_API_KEY not set — skipping Google Places lookup"
    );
    return [];
  }

  const query = `neighborhoods in ${city}, ${country}`;
  const url = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
  url.searchParams.set("query", query);
  url.searchParams.set("language", "en");
  url.searchParams.set("key", apiKey);

  try {
    const res = await fetch(url.toString());
    if (!res.ok) {
      console.warn(`[NeighborhoodDiscovery] Places API error ${res.status} for ${city}`);
      return [];
    }

    const json = (await res.json()) as TextSearchResponse;
    return (json.results ?? [])
      .slice(0, MAX_NEIGHBORHOOD_CANDIDATES)
      .map((r) => ({
        name: r.name,
        lat: r.geometry.location.lat,
        lng: r.geometry.location.lng,
      }));
  } catch {
    console.warn(`[NeighborhoodDiscovery] network error for ${city}`);
    return [];
  }
}

function buildPlaceholderPreview(
  neighborhoodName: string,
  destination: DiscoverableDestination
): NeighborhoodPreview {
  return {
    highlights: [`Explore ${neighborhoodName}`],
    safetyNote:
      "Safety data not yet available for this neighborhood — check current travel advisories before your trip.",
    sampleBundle:
      `A walkable day around ${neighborhoodName}, ${destination.name} — ` +
      `detailed eat/visit picks arrive once you select this neighborhood for place-research.`,
  };
}

// Yields one neighborhood candidate at a time as it resolves (plan Approach:
// "produces neighborhood candidates one at a time (or in small batches)").
// The generator shape is what matters here for the streaming pipeline —
// callers (the SSE route) persist and emit each candidate as soon as it's
// yielded, regardless of whether the underlying work per-item is genuinely
// async I/O (as it is here) or would be templated content in a future swap.
export async function* discoverNeighborhoods(
  destination: DiscoverableDestination
): AsyncGenerator<NeighborhoodCandidate> {
  const found = await searchNeighborhoodCandidates(destination.name, destination.country);

  for (const place of found) {
    yield {
      name: place.name,
      centroidLat: place.lat,
      centroidLng: place.lng,
      walkingRadiusMeters: DEFAULT_WALKING_RADIUS_METERS,
      familyFriendlinessScore: PLACEHOLDER_FAMILY_FRIENDLINESS_SCORE,
      dayInTheLifePreview: buildPlaceholderPreview(place.name, destination),
      sources: ["google-places-text-search"],
    };
  }
}
