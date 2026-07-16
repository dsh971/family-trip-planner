import { describe, it, expect, vi, beforeEach } from "vitest";
import { textSearchPlaces, getPlaceDetails } from "./places";

describe("textSearchPlaces", () => {
  beforeEach(() => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "test-api-key");
  });

  it("returns candidates from Text Search results (happy path)", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "OK",
        results: [
          {
            place_id: "ChIJ_place1",
            name: "Musashino Ramen",
            geometry: { location: { lat: 35.702, lng: 139.580 } },
            rating: 4.2,
            user_ratings_total: 150,
            price_level: 2,
            types: ["restaurant", "food"],
          },
          {
            place_id: "ChIJ_place2",
            name: "Kichijoji Sushi",
            geometry: { location: { lat: 35.703, lng: 139.581 } },
            rating: 4.5,
            user_ratings_total: 300,
            price_level: 3,
            types: ["restaurant", "sushi_restaurant"],
          },
        ],
      }),
    } as Response);

    const results = await textSearchPlaces("Kichijoji", "eat");
    expect(results).toHaveLength(2);
    expect(results[0]!.placeId).toBe("ChIJ_place1");
    expect(results[0]!.name).toBe("Musashino Ramen");
    expect(results[0]!.lat).toBe(35.702);
    expect(results[0]!.rating).toBe(4.2);
    expect(results[0]!.reviewCount).toBe(150);
  });

  it("returns [] without calling fetch when GOOGLE_PLACES_API_KEY is not set", async () => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "");
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy;

    const results = await textSearchPlaces("Kichijoji", "eat");
    expect(results).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns [] when API returns non-200 status", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 429,
    } as Response);

    const results = await textSearchPlaces("Yanaka", "visit");
    expect(results).toHaveLength(0);
  });

  it("returns [] when API returns empty results array", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: "ZERO_RESULTS", results: [] }),
    } as Response);

    const results = await textSearchPlaces("Shimokitazawa", "eat");
    expect(results).toHaveLength(0);
  });

  it("returns [] on network error", async () => {
    global.fetch = vi.fn().mockRejectedValueOnce(new Error("Network failure"));

    const results = await textSearchPlaces("Kichijoji", "visit");
    expect(results).toHaveLength(0);
  });

  it("maps absent rating and user_ratings_total to null", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "OK",
        results: [
          {
            place_id: "ChIJ_no_rating",
            name: "New Place",
            geometry: { location: { lat: 35.7, lng: 139.5 } },
            // no rating, no user_ratings_total, no price_level
            types: ["tourist_attraction"],
          },
        ],
      }),
    } as Response);

    const results = await textSearchPlaces("Kichijoji", "visit");
    expect(results).toHaveLength(1);
    expect(results[0]!.rating).toBeNull();
    expect(results[0]!.reviewCount).toBeNull();
    expect(results[0]!.priceLevel).toBeNull();
  });
});

describe("getPlaceDetails", () => {
  beforeEach(() => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "test-api-key");
  });

  it("returns PlaceDetails with colon-inserted startTime (happy path)", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "OK",
        result: {
          child_friendly: true,
          menu_for_children: false,
          opening_hours: {
            periods: [{ open: { time: "1100" } }, { open: { time: "1800" } }],
          },
        },
      }),
    } as Response);

    const details = await getPlaceDetails("ChIJ_place1");
    expect(details).not.toBeNull();
    expect(details!.goodForChildren).toBe(true);
    expect(details!.menuForChildren).toBe(false);
    expect(details!.openingHours).toHaveLength(2);
    expect(details!.openingHours[0]!.startTime).toBe("11:00");
    expect(details!.openingHours[1]!.startTime).toBe("18:00");
  });

  it("returns goodForChildren: null when child_friendly is absent", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "OK",
        result: {
          opening_hours: {
            periods: [{ open: { time: "0900" } }],
          },
        },
      }),
    } as Response);

    const details = await getPlaceDetails("ChIJ_no_child");
    expect(details).not.toBeNull();
    expect(details!.goodForChildren).toBeNull();
    expect(details!.menuForChildren).toBeNull();
    expect(details!.openingHours[0]!.startTime).toBe("09:00");
  });

  it("returns openingHours: [] when opening_hours is absent", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "OK",
        result: {
          child_friendly: true,
        },
      }),
    } as Response);

    const details = await getPlaceDetails("ChIJ_no_hours");
    expect(details).not.toBeNull();
    expect(details!.openingHours).toEqual([]);
  });

  it("returns null on non-200 status", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 404,
    } as Response);

    const details = await getPlaceDetails("ChIJ_missing");
    expect(details).toBeNull();
  });

  it("returns null on network error", async () => {
    global.fetch = vi.fn().mockRejectedValueOnce(new Error("timeout"));

    const details = await getPlaceDetails("ChIJ_timeout");
    expect(details).toBeNull();
  });
});
