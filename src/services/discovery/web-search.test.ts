import { describe, it, expect, vi, beforeEach } from "vitest";
import { searchCandidates } from "./web-search";

describe("web-search: searchCandidates", () => {
  beforeEach(() => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "test-api-key");
    vi.stubEnv("GOOGLE_CSE_CX", "test-cx-id");
  });

  it("returns candidates from Google CSE items", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [
          { title: "Musashino Ramen", link: "https://example.com/1", snippet: "Great ramen near the park" },
          { title: "Kichijoji Sushi", link: "https://example.com/2", snippet: "Family sushi bar" },
        ],
      }),
    } as Response);

    const results = await searchCandidates("Kichijoji", "eat");
    expect(results).toHaveLength(2);
    expect(results[0]!.name).toBe("Musashino Ramen");
    expect(results[1]!.name).toBe("Kichijoji Sushi");
    // CSE has no address field — address enrichment happens via Google Places
    expect(results[0]!.address).toBeNull();
  });

  it("returns empty array when GOOGLE_CSE_CX is not set", async () => {
    vi.stubEnv("GOOGLE_CSE_CX", "");
    const results = await searchCandidates("Kichijoji", "eat");
    expect(results).toHaveLength(0);
  });

  it("returns empty array when GOOGLE_PLACES_API_KEY is not set", async () => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "");
    const results = await searchCandidates("Kichijoji", "eat");
    expect(results).toHaveLength(0);
  });

  it("returns empty array on Google CSE API error (graceful degradation)", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 429,
    } as Response);

    const results = await searchCandidates("Kichijoji", "eat");
    expect(results).toHaveLength(0);
  });

  it("handles missing items array", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    } as Response);

    const results = await searchCandidates("Kichijoji", "visit");
    expect(results).toHaveLength(0);
  });
});
