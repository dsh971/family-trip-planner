// Web search layer (KTD-C Stage 1): candidate breadth via Google Custom Search JSON API.
// Results are a candidate pool only — no inherent trust signal.
// API key: GOOGLE_PLACES_API_KEY (Custom Search API must be enabled on the same project).
// Search engine ID: GOOGLE_CSE_CX (create at programmablesearchengine.google.com,
//   configured to search the entire web).
// Free tier: 100 queries/day; no charge below that limit.

export interface WebSearchCandidate {
  name: string;
  address: string | null;
  snippet: string;
  url: string;
}

interface CseSearchItem {
  title: string;
  link: string;
  snippet: string;
}

// Searches for family-friendly places in a given category and neighborhood.
// Returns raw candidate names+addresses for Google Places enrichment.
// city comes from the trip's actual destination (destinations.name) — no hardcoded
// "Tokyo" suffix (plan 2026-08-20-011 U2 follow-up), same pattern as places.ts.
export async function searchCandidates(
  neighborhoodName: string,
  category: "eat" | "visit",
  city: string
): Promise<WebSearchCandidate[]> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  const cx = process.env.GOOGLE_CSE_CX;

  if (!apiKey || !cx) {
    console.warn("[WebSearch] GOOGLE_PLACES_API_KEY or GOOGLE_CSE_CX not set — skipping web search candidates");
    return [];
  }

  const categoryLabel = category === "eat" ? "family-friendly restaurants" : "things to do for families";
  const query = `best ${categoryLabel} ${neighborhoodName} ${city} 2025`;

  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("cx", cx);
  url.searchParams.set("q", query);
  url.searchParams.set("num", "10");
  // No `gl` region-bias param: it needs an ISO 3166-1 ccTLD code, and
  // destinations.country is free text (e.g. "Japan" or "JP" depending on how the
  // row was created) with no reliable code mapping in this codebase — same reasoning
  // as textSearchPlaces in places.ts. Pinning a guessed/wrong code (the old hardcoded
  // "jp") would be worse than no bias; the query text above already carries the real
  // destination's city.
  url.searchParams.set("hl", "en");

  const res = await fetch(url.toString());

  if (!res.ok) {
    console.warn(`[WebSearch] Google CSE error: ${res.status} — skipping web search for ${neighborhoodName}`);
    return [];
  }

  const json = await res.json() as { items?: CseSearchItem[] };

  // Google CSE doesn't return a structured address field; address enrichment
  // happens downstream via Google Places (Find Place from Text).
  return (json.items ?? []).map((r) => ({
    name: r.title,
    address: null,
    snippet: r.snippet,
    url: r.link,
  }));
}
