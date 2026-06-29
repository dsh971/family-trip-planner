import { describe, it, expect, vi, beforeEach } from "vitest";
import { geocodeHotelAddress, HotelNotFoundError } from "./geocoding";

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
