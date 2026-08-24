export interface GeocodingResult {
  lat: number;
  lng: number;
  formattedAddress: string;
}

export class HotelNotFoundError extends Error {
  constructor(public readonly query: string) {
    super(`Couldn't locate hotel address: "${query}". Please check the name and address and try again.`);
    this.name = "HotelNotFoundError";
  }
}

// Finds a named hotel using Google Places "Find Place from Text" endpoint (KTD-L).
// Reuses the same Google Places API key as discovery (U6) — no separate Geocoding API needed.
export async function geocodeHotelAddress(
  hotelName: string,
  hotelAddress: string
): Promise<GeocodingResult> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    throw new Error("GOOGLE_PLACES_API_KEY is not set");
  }

  const query = `${hotelName} ${hotelAddress}`.trim();
  const url = new URL(
    "https://maps.googleapis.com/maps/api/place/findplacefromtext/json"
  );
  url.searchParams.set("input", query);
  url.searchParams.set("inputtype", "textquery");
  url.searchParams.set("fields", "geometry,formatted_address");
  url.searchParams.set("key", apiKey);

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Google Places API error: ${res.status} ${res.statusText}`);
  }

  const json = (await res.json()) as {
    status: string;
    candidates: Array<{
      geometry: { location: { lat: number; lng: number } };
      formatted_address: string;
    }>;
  };

  if (json.status !== "OK" || json.candidates.length === 0) {
    throw new HotelNotFoundError(query);
  }

  const candidate = json.candidates[0]!;
  return {
    lat: candidate.geometry.location.lat,
    lng: candidate.geometry.location.lng,
    formattedAddress: candidate.formatted_address,
  };
}

// City-level geocoding for the Trip setup preview panel (TripSetupArt).
//
// Deliberately NOT reusing geocodeHotelAddress's "Find Place from Text"
// endpoint: that endpoint is tuned for disambiguating one specific named
// place (a hotel) and, empirically, returns ZERO_RESULTS for bare city-
// level queries like "Lisbon, Portugal" against this project's live API
// key — confirmed by hitting it directly, not assumed. Every OTHER live
// Google Places integration in this codebase (textSearchPlaces in
// src/services/discovery/places.ts, the neighborhood-discovery lookup in
// src/services/neighborhoods/discover.ts) uses the plain Text Search
// endpoint instead, and both are proven working against this same key —
// so city geocoding follows that established, working pattern rather than
// the narrower one-off "Find Place from Text" call.
//
// Returns null rather than throwing on a no-match, since this is a live
// preview-as-you-type, not a form submission: a not-yet-recognized city
// name mid-typing is an expected, non-error state the caller should fall
// back on quietly, not surface as an error.
export async function geocodeCity(
  name: string,
  country?: string
): Promise<GeocodingResult | null> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    throw new Error("GOOGLE_PLACES_API_KEY is not set");
  }

  const query = country ? `${name}, ${country}` : name;

  const url = new URL(
    "https://maps.googleapis.com/maps/api/place/textsearch/json"
  );
  url.searchParams.set("query", query.trim());
  url.searchParams.set("language", "en");
  url.searchParams.set("key", apiKey);

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Google Places API error: ${res.status} ${res.statusText}`);
  }

  const json = (await res.json()) as {
    status: string;
    results: Array<{
      geometry: { location: { lat: number; lng: number } };
      formatted_address: string;
    }>;
  };

  if (json.status !== "OK" || json.results.length === 0) {
    // ZERO_RESULTS is an expected, silent case (a partially-typed or
    // genuinely unrecognized city name) — anything else (REQUEST_DENIED,
    // OVER_QUERY_LIMIT, INVALID_REQUEST, ...) is a real upstream failure
    // worth a server-side warning, matching the existing warn-and-degrade
    // pattern in src/services/discovery/places.ts's textSearchPlaces.
    // Both still resolve to null for the caller either way — TripSetupArt
    // is a live preview-as-you-type, not a form submission, so there's no
    // good way to surface a distinct error state to the traveler here; the
    // warning is for whoever's debugging why the map preview isn't showing.
    if (json.status !== "ZERO_RESULTS") {
      console.warn(`[geocodeCity] Google Places returned ${json.status} for "${query}"`);
    }
    return null;
  }

  const result = json.results[0]!;
  return {
    lat: result.geometry.location.lat,
    lng: result.geometry.location.lng,
    formattedAddress: result.formatted_address,
  };
}
