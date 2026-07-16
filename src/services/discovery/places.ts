export interface PlaceTextSearchResult {
  placeId: string;
  name: string;
  lat: number;
  lng: number;
  rating: number | null;
  reviewCount: number | null;
  priceLevel: number | null;
  types: string[];
}

export interface PlaceDetails {
  goodForChildren: boolean | null;
  menuForChildren: boolean | null;
  openingHours: Array<{ startTime: string }>;
}

interface TextSearchResponseItem {
  place_id: string;
  name: string;
  geometry: { location: { lat: number; lng: number } };
  rating?: number;
  user_ratings_total?: number;
  price_level?: number;
  types?: string[];
}

interface TextSearchResponse {
  status: string;
  results: TextSearchResponseItem[];
}

interface DetailsResponse {
  status: string;
  result: {
    child_friendly?: boolean;
    menu_for_children?: boolean;
    opening_hours?: {
      periods: Array<{ open: { time: string } }>;
    };
  };
}

export async function textSearchPlaces(
  neighborhoodName: string,
  category: "eat" | "visit"
): Promise<PlaceTextSearchResult[]> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    console.warn("[TextSearch] GOOGLE_PLACES_API_KEY not set — skipping text search");
    return [];
  }

  const categoryLabel =
    category === "eat" ? "restaurants" : "attractions and activities";
  const query = `family ${categoryLabel} ${neighborhoodName} Tokyo`;

  const url = new URL(
    "https://maps.googleapis.com/maps/api/place/textsearch/json"
  );
  url.searchParams.set("query", query);
  url.searchParams.set("language", "en");
  url.searchParams.set("region", "jp");
  url.searchParams.set("key", apiKey);

  try {
    const res = await fetch(url.toString());

    if (!res.ok) {
      console.warn(
        `[TextSearch] error ${res.status} for ${neighborhoodName}`
      );
      return [];
    }

    const json = (await res.json()) as TextSearchResponse;

    return (json.results ?? []).map((r) => ({
      placeId: r.place_id,
      name: r.name,
      lat: r.geometry.location.lat,
      lng: r.geometry.location.lng,
      rating: r.rating ?? null,
      reviewCount: r.user_ratings_total ?? null,
      priceLevel: r.price_level ?? null,
      types: r.types ?? [],
    }));
  } catch {
    console.warn(`[TextSearch] network error for ${neighborhoodName}`);
    return [];
  }
}

export async function getPlaceDetails(
  placeId: string
): Promise<PlaceDetails | null> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return null;

  const url = new URL(
    "https://maps.googleapis.com/maps/api/place/details/json"
  );
  url.searchParams.set("place_id", placeId);
  url.searchParams.set("fields", "child_friendly,menu_for_children,opening_hours");
  url.searchParams.set("key", apiKey);

  try {
    const res = await fetch(url.toString());

    if (!res.ok) return null;

    const json = (await res.json()) as DetailsResponse;
    if (json.status !== "OK") return null;

    const r = json.result;

    // opening_hours.periods[].open.time is "HHMM" (4-digit, no colon).
    // filters.ts:parseTime splits on ":" so colon insertion is required.
    const openingHours = (r.opening_hours?.periods ?? []).map((p) => {
      const raw = p.open.time;
      const startTime = `${raw.slice(0, 2)}:${raw.slice(2)}`;
      return { startTime };
    });

    return {
      goodForChildren: r.child_friendly ?? null,
      menuForChildren: r.menu_for_children ?? null,
      openingHours,
    };
  } catch {
    return null;
  }
}
