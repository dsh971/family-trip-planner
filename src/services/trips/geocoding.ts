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
