import { describe, it, expect, vi, beforeEach } from "vitest";
import { textSearchPlaces, getPlaceDetails, resolvePhotoUrl, findNearbyTransitStations } from "./places";

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

  it("returns photoReference from photos[0] in text search results", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "OK",
        results: [
          {
            place_id: "ChIJ_photo_place",
            name: "Ramen Shop",
            geometry: { location: { lat: 35.7, lng: 139.5 } },
            types: ["restaurant"],
            photos: [{ photo_reference: "CmRaAAAAtest_ref_123" }],
          },
        ],
      }),
    } as Response);

    const results = await textSearchPlaces("Kichijoji", "eat");
    expect(results[0]!.photoReference).toBe("CmRaAAAAtest_ref_123");
  });

  it("returns photoReference: null when photos array is absent", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "OK",
        results: [
          {
            place_id: "ChIJ_no_photo",
            name: "Museum",
            geometry: { location: { lat: 35.7, lng: 139.5 } },
            types: ["museum"],
          },
        ],
      }),
    } as Response);

    const results = await textSearchPlaces("Kichijoji", "visit");
    expect(results[0]!.photoReference).toBeNull();
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

  it("returns description when editorial_summary is present (happy path)", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "OK",
        result: {
          editorial_summary: { overview: "A lively ramen spot in Shinjuku." },
        },
      }),
    } as Response);

    const details = await getPlaceDetails("ChIJ_with_summary");
    expect(details).not.toBeNull();
    expect(details!.description).toBe("A lively ramen spot in Shinjuku.");
  });

  it("returns description: null when editorial_summary key is absent", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "OK",
        result: { child_friendly: true },
      }),
    } as Response);

    const details = await getPlaceDetails("ChIJ_no_summary");
    expect(details).not.toBeNull();
    expect(details!.description).toBeNull();
  });

  it("returns description: null when editorial_summary has no overview key", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "OK",
        result: {
          editorial_summary: {} as { overview: string },
        },
      }),
    } as Response);

    const details = await getPlaceDetails("ChIJ_empty_summary");
    expect(details).not.toBeNull();
    expect(details!.description).toBeNull();
  });
});

describe("findNearbyTransitStations", () => {
  beforeEach(() => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "test-api-key");
  });

  it("returns up to 5 transit stations from a valid response", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "OK",
        results: [
          { place_id: "s1", name: "Shinjuku Station", geometry: { location: { lat: 35.689, lng: 139.700 } } },
          { place_id: "s2", name: "Shinjuku-Sanchome Station", geometry: { location: { lat: 35.690, lng: 139.703 } } },
          { place_id: "s3", name: "Nishi-Shinjuku Station", geometry: { location: { lat: 35.691, lng: 139.696 } } },
          { place_id: "s4", name: "Higashi-Shinjuku Station", geometry: { location: { lat: 35.692, lng: 139.706 } } },
          { place_id: "s5", name: "Shinjuku-Nishiguchi Station", geometry: { location: { lat: 35.693, lng: 139.698 } } },
          { place_id: "s6", name: "Extra Station", geometry: { location: { lat: 35.694, lng: 139.710 } } },
        ],
      }),
    } as Response);

    const stations = await findNearbyTransitStations(35.689, 139.700);
    expect(stations).toHaveLength(5);
    expect(stations[0]!.placeId).toBe("s1");
    expect(stations[0]!.name).toBe("Shinjuku Station");
    expect(stations[0]!.lat).toBe(35.689);
    expect(stations[0]!.lng).toBe(139.700);
  });

  it("returns fewer than 5 when API returns fewer results", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "OK",
        results: [
          { place_id: "s1", name: "Shibuya Station", geometry: { location: { lat: 35.658, lng: 139.701 } } },
        ],
      }),
    } as Response);

    const stations = await findNearbyTransitStations(35.658, 139.701);
    expect(stations).toHaveLength(1);
  });

  it("returns [] when results array is empty (ZERO_RESULTS)", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: "ZERO_RESULTS", results: [] }),
    } as Response);

    const stations = await findNearbyTransitStations(35.689, 139.700);
    expect(stations).toHaveLength(0);
  });

  it("returns [] on non-OK HTTP status", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({ ok: false, status: 429 } as Response);

    const stations = await findNearbyTransitStations(35.689, 139.700);
    expect(stations).toHaveLength(0);
  });

  it("returns [] on network error", async () => {
    global.fetch = vi.fn().mockRejectedValueOnce(new Error("Network failure"));

    const stations = await findNearbyTransitStations(35.689, 139.700);
    expect(stations).toHaveLength(0);
  });

  it("returns [] without calling fetch when GOOGLE_PLACES_API_KEY is not set", async () => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "");
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy;

    const stations = await findNearbyTransitStations(35.689, 139.700);
    expect(stations).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("resolvePhotoUrl", () => {
  beforeEach(() => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "test-api-key");
  });

  it("returns the CDN URL from the 302 Location header", async () => {
    const cdnUrl = "https://lh3.googleusercontent.com/places/abc123";
    global.fetch = vi.fn().mockResolvedValueOnce({
      headers: { get: (k: string) => k === "location" ? cdnUrl : null },
    } as unknown as Response);

    const result = await resolvePhotoUrl("CmRaAAAAtest_ref", 400);
    expect(result).toBe(cdnUrl);
  });

  it("returns null when GOOGLE_PLACES_API_KEY is not set", async () => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "");
    const result = await resolvePhotoUrl("CmRaAAAAtest_ref");
    expect(result).toBeNull();
  });

  it("returns null when the photo API returns no Location header", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      headers: { get: () => null },
    } as unknown as Response);

    const result = await resolvePhotoUrl("bad_ref");
    expect(result).toBeNull();
  });

  it("returns null on network error", async () => {
    global.fetch = vi.fn().mockRejectedValueOnce(new Error("Network failure"));
    const result = await resolvePhotoUrl("CmRaAAAAtest_ref");
    expect(result).toBeNull();
  });
});
