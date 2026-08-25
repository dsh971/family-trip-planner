import { describe, it, expect, vi, beforeEach } from "vitest";
import { geocodeHotelAddress, geocodeCity, HotelNotFoundError } from "./geocoding";

describe("geocodeHotelAddress", () => {
  beforeEach(() => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "test-api-key");
  });

  it("returns lat/lng and formatted address for a valid hotel", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "OK",
        candidates: [
          {
            geometry: { location: { lat: 35.6895, lng: 139.6917 } },
            formatted_address: "3-7-1-2 Nishi Shinjuku, Shinjuku, Tokyo 163-1055, Japan",
          },
        ],
      }),
    } as Response);

    const result = await geocodeHotelAddress("Park Hyatt Tokyo", "3-7-1 Nishi Shinjuku");
    expect(result.lat).toBeCloseTo(35.6895, 4);
    expect(result.lng).toBeCloseTo(139.6917, 4);
    expect(result.formattedAddress).toContain("Shinjuku");
  });

  it("throws HotelNotFoundError when Google Places returns no candidates", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: "ZERO_RESULTS", candidates: [] }),
    } as Response);

    await expect(
      geocodeHotelAddress("Totally Fake Hotel XYZ", "1 Nowhere St")
    ).rejects.toThrow(HotelNotFoundError);
  });

  it("distinguishes HotelNotFoundError from intentionally-blank hotel (KTD-L)", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: "ZERO_RESULTS", candidates: [] }),
    } as Response);

    const err = await geocodeHotelAddress("Typo Hotel", "bad address").catch((e) => e);
    expect(err).toBeInstanceOf(HotelNotFoundError);
    expect(err.message).toMatch(/couldn't locate/i);
  });

  it("throws on non-OK HTTP response", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: "Forbidden",
    } as Response);

    await expect(
      geocodeHotelAddress("Hotel", "Address")
    ).rejects.toThrow(/403/);
  });
});

describe("geocodeCity", () => {
  beforeEach(() => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "test-api-key");
  });

  it("returns lat/lng for a valid city + country, via the Text Search endpoint (not Find Place)", async () => {
    global.fetch = vi.fn().mockImplementationOnce((url: string) => {
      expect(url).toContain("/place/textsearch/json");
      // URLSearchParams encodes spaces as "+", not encodeURIComponent's "%20"
      expect(url).toContain("query=Lisbon%2C+Portugal");
      return Promise.resolve({
        ok: true,
        json: async () => ({
          status: "OK",
          results: [
            {
              geometry: { location: { lat: 38.7223, lng: -9.1393 } },
              formatted_address: "Lisbon, Portugal",
            },
          ],
        }),
      } as Response);
    });

    const result = await geocodeCity("Lisbon", "Portugal");
    expect(result?.lat).toBeCloseTo(38.7223, 4);
    expect(result?.lng).toBeCloseTo(-9.1393, 4);
  });

  it("queries by name alone when no country is given", async () => {
    global.fetch = vi.fn().mockImplementationOnce((url: string) => {
      expect(url).toContain(encodeURIComponent("Lisbon"));
      expect(url).not.toContain(encodeURIComponent("Lisbon,"));
      return Promise.resolve({
        ok: true,
        json: async () => ({
          status: "OK",
          results: [{ geometry: { location: { lat: 38.7223, lng: -9.1393 } }, formatted_address: "Lisbon" }],
        }),
      } as Response);
    });

    const result = await geocodeCity("Lisbon");
    expect(result?.lat).toBeCloseTo(38.7223, 4);
  });

  it("returns null (not a throw) when nothing matches — a live preview shouldn't error on a partially-typed name", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: "ZERO_RESULTS", results: [] }),
    } as Response);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await geocodeCity("asdkjqwe");
    expect(result).toBeNull();
    // ZERO_RESULTS is expected/silent — no warning for this one.
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("logs a warning (but still resolves null, not a throw) on a non-ZERO_RESULTS API failure", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "REQUEST_DENIED",
        results: [],
        error_message: "You must enable Billing on the Google Cloud Project",
      }),
    } as Response);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await geocodeCity("Lisbon", "Portugal");
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("REQUEST_DENIED"));
    warnSpy.mockRestore();
  });

  it("includes Google's error_message in the warning when present, so a billing-style failure is diagnosable from the log line alone (U2)", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "REQUEST_DENIED",
        results: [],
        error_message: "You must enable Billing on the Google Cloud Project",
      }),
    } as Response);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await geocodeCity("Lisbon", "Portugal");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("You must enable Billing on the Google Cloud Project")
    );
    warnSpy.mockRestore();
  });

  it("still warns without a trailing dash when Google sends no error_message", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: "OVER_QUERY_LIMIT", results: [] }),
    } as Response);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await geocodeCity("Lisbon", "Portugal");
    expect(warnSpy).toHaveBeenCalledWith('[geocodeCity] Google Places returned OVER_QUERY_LIMIT for "Lisbon, Portugal"');
    warnSpy.mockRestore();
  });
});
