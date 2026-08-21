import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateDestinationHighlight, discoverNeighborhoods } from "./discover";

const destination = { id: 1, name: "Lisbon", country: "Portugal" };

describe("generateDestinationHighlight", () => {
  it("returns a non-empty blurb mentioning the destination's name and country", () => {
    const highlight = generateDestinationHighlight(destination);
    expect(highlight).toContain("Lisbon");
    expect(highlight).toContain("Portugal");
    expect(highlight.length).toBeGreaterThan(0);
  });
});

describe("discoverNeighborhoods", () => {
  beforeEach(() => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "test-api-key");
  });

  it("yields a candidate per Google Places Text Search result, with real geocoded centroids", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "OK",
        results: [
          { name: "Alfama", geometry: { location: { lat: 38.712, lng: -9.13 } } },
          { name: "Belém", geometry: { location: { lat: 38.697, lng: -9.206 } } },
        ],
      }),
    } as Response);

    const candidates = [];
    for await (const c of discoverNeighborhoods(destination)) candidates.push(c);

    expect(candidates).toHaveLength(2);
    expect(candidates[0]!.name).toBe("Alfama");
    expect(candidates[0]!.centroidLat).toBe(38.712);
    expect(candidates[0]!.centroidLng).toBe(-9.13);
    expect(candidates[1]!.name).toBe("Belém");
  });

  it("caps at 3 candidates even when Google Places returns more", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "OK",
        results: Array.from({ length: 8 }, (_, i) => ({
          name: `District ${i}`,
          geometry: { location: { lat: 38.7 + i, lng: -9.1 } },
        })),
      }),
    } as Response);

    const candidates = [];
    for await (const c of discoverNeighborhoods(destination)) candidates.push(c);

    expect(candidates).toHaveLength(3);
  });

  it("every candidate has a schema-shaped, non-empty dayInTheLifePreview and sources", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "OK",
        results: [{ name: "Alfama", geometry: { location: { lat: 38.712, lng: -9.13 } } }],
      }),
    } as Response);

    const candidates = [];
    for await (const c of discoverNeighborhoods(destination)) candidates.push(c);

    const c = candidates[0]!;
    expect(c.dayInTheLifePreview.highlights.length).toBeGreaterThan(0);
    expect(c.dayInTheLifePreview.safetyNote.length).toBeGreaterThan(0);
    expect(c.dayInTheLifePreview.sampleBundle.length).toBeGreaterThan(0);
    expect(c.sources).toEqual(["google-places-text-search"]);
    expect(c.walkingRadiusMeters).toBeGreaterThan(0);
    expect(c.familyFriendlinessScore).toBeGreaterThanOrEqual(0);
  });

  it("yields zero candidates without throwing when GOOGLE_PLACES_API_KEY is not set", async () => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "");
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy;

    const candidates = [];
    for await (const c of discoverNeighborhoods(destination)) candidates.push(c);

    expect(candidates).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("yields zero candidates without throwing on a non-200 API response", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({ ok: false, status: 500 } as Response);

    const candidates = [];
    for await (const c of discoverNeighborhoods(destination)) candidates.push(c);

    expect(candidates).toHaveLength(0);
  });

  it("yields zero candidates without throwing on a network error", async () => {
    global.fetch = vi.fn().mockRejectedValueOnce(new Error("network down"));

    const candidates = [];
    for await (const c of discoverNeighborhoods(destination)) candidates.push(c);

    expect(candidates).toHaveLength(0);
  });
});
