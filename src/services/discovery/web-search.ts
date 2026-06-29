// Web search layer (KTD-C Stage 1): candidate breadth via Serper API.
// Results are a candidate pool only — no inherent trust signal.

export interface WebSearchCandidate {
  name: string;
  address: string | null;
  snippet: string;
  url: string;
}

export interface SerperSearchResult {
  title: string;
  link: string;
  snippet: string;
  address?: string;
}

// Searches for family-friendly places in a given category and neighborhood.
// Returns raw candidate names+addresses for Google Places enrichment.
export async function searchCandidates(
  neighborhoodName: string,
  category: "eat" | "visit"
): Promise<WebSearchCandidate[]> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    console.warn("[WebSearch] SERPER_API_KEY not set — skipping web search candidates");
    return [];
  }

  const categoryLabel = category === "eat" ? "family-friendly restaurants" : "things to do for families";
  const query = `best ${categoryLabel} ${neighborhoodName} Tokyo 2025`;

  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ q: query, num: 10, gl: "jp", hl: "en" }),
  });

  if (!res.ok) {
    console.warn(`[WebSearch] Serper API error: ${res.status} — skipping web search for ${neighborhoodName}`);
    return [];
  }

  const json = await res.json() as { organic?: SerperSearchResult[] };

  return (json.organic ?? []).map((r) => ({
    name: r.title,
    address: r.address ?? null,
    snippet: r.snippet,
    url: r.link,
  }));
}
