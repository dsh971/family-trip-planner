import { describe, it, expect, vi, beforeEach } from "vitest";
import { searchCandidates } from "./web-search";

describe("web-search: searchCandidates", () => {
  beforeEach(() => {
    vi.stubEnv("SERPER_API_KEY", "test-key");
  });

  it("returns candidates from Serper organic results", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        organic: [
          { title: "Musashino Ramen", link: "https://example.com/1", snippet: "Great ramen near the park" },
          { title: "Kichijoji Sushi", link: "https://example.com/2", snippet: "Family sushi bar" },
        ],
      }),
    } as Response);

    const results = await searchCandidates("Kichijoji", "eat");
    expect(results).toHaveLength(2);
    expect(results[0]!.name).toBe("Musashino Ramen");
    expect(results[1]!.name).toBe("Kichijoji Sushi");
  });

  it("returns empty array when SERPER_API_KEY is not set", async () => {
    vi.stubEnv("SERPER_API_KEY", "");
    const results = await searchCandidates("Kichijoji", "eat");
    expect(results).toHaveLength(0);
  });

  it("returns empty array on Serper API error (graceful degradation)", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 429,
    } as Response);

    const results = await searchCandidates("Kichijoji", "eat");
    expect(results).toHaveLength(0);
  });

  it("handles empty organic array", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ organic: [] }),
    } as Response);

    const results = await searchCandidates("Kichijoji", "visit");
    expect(results).toHaveLength(0);
  });
});
