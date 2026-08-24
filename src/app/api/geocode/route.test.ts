import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/services/trips/geocoding", () => ({
  geocodeCity: vi.fn(),
}));

async function makeGetRequest(query: string) {
  const { GET } = await import("./route");
  const req = new Request(`http://localhost/api/geocode${query}`);
  return GET(req);
}

describe("GET /api/geocode", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { _resetRateLimitForTesting } = await import("./route");
    _resetRateLimitForTesting();
  });

  it("returns lat/lng for a valid city", async () => {
    const { geocodeCity } = await import("@/services/trips/geocoding");
    vi.mocked(geocodeCity).mockResolvedValueOnce({
      lat: 38.7223,
      lng: -9.1393,
      formattedAddress: "Lisbon, Portugal",
    });

    const res = await makeGetRequest("?city=Lisbon&country=Portugal");
    expect(res.status).toBe(200);
    const json = await res.json() as { lat: number; lng: number };
    expect(json.lat).toBeCloseTo(38.7223, 4);
    expect(json.lng).toBeCloseTo(-9.1393, 4);
    expect(geocodeCity).toHaveBeenCalledWith("Lisbon", "Portugal");
  });

  it("works without a country", async () => {
    const { geocodeCity } = await import("@/services/trips/geocoding");
    vi.mocked(geocodeCity).mockResolvedValueOnce({
      lat: 38.7223,
      lng: -9.1393,
      formattedAddress: "Lisbon",
    });

    const res = await makeGetRequest("?city=Lisbon");
    expect(res.status).toBe(200);
    expect(geocodeCity).toHaveBeenCalledWith("Lisbon", undefined);
  });

  it("400s when city is missing", async () => {
    const res = await makeGetRequest("?country=Portugal");
    expect(res.status).toBe(400);
  });

  it("404s when geocodeCity finds nothing", async () => {
    const { geocodeCity } = await import("@/services/trips/geocoding");
    vi.mocked(geocodeCity).mockResolvedValueOnce(null);

    const res = await makeGetRequest("?city=asdkjqwe");
    expect(res.status).toBe(404);
  });

  it("502s when geocodeCity throws (e.g. missing API key upstream)", async () => {
    const { geocodeCity } = await import("@/services/trips/geocoding");
    vi.mocked(geocodeCity).mockRejectedValueOnce(new Error("GOOGLE_PLACES_API_KEY is not set"));

    const res = await makeGetRequest("?city=Lisbon");
    expect(res.status).toBe(502);
  });

  it("rate-limits after the configured burst", async () => {
    const { geocodeCity } = await import("@/services/trips/geocoding");
    vi.mocked(geocodeCity).mockResolvedValue({ lat: 0, lng: 0, formattedAddress: "x" });

    for (let i = 0; i < 30; i++) {
      const res = await makeGetRequest("?city=Lisbon");
      expect(res.status).toBe(200);
    }
    const res = await makeGetRequest("?city=Lisbon");
    expect(res.status).toBe(429);
  });
});
