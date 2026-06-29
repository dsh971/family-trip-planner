/**
 * E2E: Itinerary recompute flow.
 *
 * Tests the key user journey: build itinerary → verify days appear → recompute
 * → confirm itinerary re-renders.
 *
 * These tests hit the real Next.js server with mocked API responses (via route
 * interception) so they don't require live API keys. The mock responses mirror
 * what the real /api/itinerary endpoints return.
 */

import { test, expect } from "@playwright/test";

const TRIP_ID = 1;

const mockItineraryResponse = {
  tripId: TRIP_ID,
  neighborhood: "Kichijoji",
  days: [
    {
      date: "2025-07-10",
      dayId: 1,
      segments: [
        {
          id: 1,
          dayId: 1,
          order: "a",
          segmentType: "place",
          placeId: 10,
          adjustmentState: "scheduled",
          startTime: null,
          endTime: null,
          payload: { category: "eat", placeName: "Musashino Ramen", worthTheDetour: false },
        },
        {
          id: 5,
          dayId: 1,
          order: "a0",
          segmentType: "route",
          placeId: null,
          adjustmentState: "scheduled",
          startTime: null,
          endTime: null,
          payload: {
            fromName: "Musashino Ramen",
            toName: "Inokashira Park",
            distanceMeters: 450,
            walkingMinutes: 6,
            safetyConcern: false,
            safetyConcernName: null,
            wgAvailable: true,
            note: null,
          },
        },
        {
          id: 2,
          dayId: 1,
          order: "b",
          segmentType: "pacing-block",
          placeId: null,
          adjustmentState: "scheduled",
          startTime: "13:00",
          endTime: "15:00",
          payload: { windowName: "nap", label: "Nap / rest time" },
        },
        {
          id: 3,
          dayId: 1,
          order: "c",
          segmentType: "place",
          placeId: 11,
          adjustmentState: "scheduled",
          startTime: null,
          endTime: null,
          payload: { category: "visit", placeName: "Inokashira Park", worthTheDetour: false },
        },
      ],
    },
    {
      date: "2025-07-11",
      dayId: 2,
      segments: [
        {
          id: 4,
          dayId: 2,
          order: "a",
          segmentType: "place",
          placeId: 12,
          adjustmentState: "scheduled",
          startTime: null,
          endTime: null,
          payload: { category: "visit", placeName: "Kichijoji Harmonica Alley", worthTheDetour: false },
        },
      ],
    },
  ],
  overflow: [],
};

const emptyItineraryResponse = {
  tripId: TRIP_ID,
  days: [],
  neighborhood: "Kichijoji",
};

test.describe("Itinerary page", () => {
  test("shows build button when no itinerary exists", async ({ page }) => {
    await page.route(`/api/itinerary?tripId=${TRIP_ID}`, (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(emptyItineraryResponse),
      });
    });

    await page.goto(`/trip/${TRIP_ID}/itinerary`);
    await expect(page.getByTestId("build-itinerary-btn")).toBeVisible();
    await expect(page.getByTestId("build-itinerary-btn")).toHaveText("Build itinerary");
  });

  test("renders day cards after building itinerary", async ({ page }) => {
    // GET returns empty first, then POST builds and returns populated schedule
    let getCount = 0;
    await page.route(`/api/itinerary?tripId=${TRIP_ID}`, (route) => {
      getCount++;
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(getCount === 1 ? emptyItineraryResponse : mockItineraryResponse),
      });
    });

    await page.route("/api/itinerary", (route) => {
      if (route.request().method() === "POST") {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(mockItineraryResponse),
        });
      }
    });

    await page.goto(`/trip/${TRIP_ID}/itinerary`);
    await page.getByTestId("build-itinerary-btn").click();

    // Wait for itinerary days to appear
    await expect(page.getByTestId("itinerary-days")).toBeVisible();

    // Verify day headers and place names
    await expect(page.getByText("Musashino Ramen")).toBeVisible();
    await expect(page.getByText("Inokashira Park")).toBeVisible();
    await expect(page.getByText("Kichijoji Harmonica Alley")).toBeVisible();
  });

  test("recompute button appears after initial build", async ({ page }) => {
    await page.route(`/api/itinerary?tripId=${TRIP_ID}`, (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(emptyItineraryResponse),
      });
    });

    await page.route("/api/itinerary", (route) => {
      if (route.request().method() === "POST") {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(mockItineraryResponse),
        });
      }
    });

    await page.goto(`/trip/${TRIP_ID}/itinerary`);
    await page.getByTestId("build-itinerary-btn").click();

    await expect(page.getByTestId("itinerary-days")).toBeVisible();
    await expect(page.getByTestId("build-itinerary-btn")).toHaveText("Recompute itinerary");
  });

  test("shows route walking time between adjacent places", async ({ page }) => {
    await page.route(`/api/itinerary?tripId=${TRIP_ID}`, (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(emptyItineraryResponse),
      });
    });

    await page.route("/api/itinerary", (route) => {
      if (route.request().method() === "POST") {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(mockItineraryResponse),
        });
      }
    });

    await page.goto(`/trip/${TRIP_ID}/itinerary`);
    await page.getByTestId("build-itinerary-btn").click();

    await expect(page.getByTestId("itinerary-days")).toBeVisible();
    await expect(page.getByText("6 min walk")).toBeVisible();
  });

  test("shows safety concern badge on flagged routes", async ({ page }) => {
    const safetyRoutePayload = {
      fromName: "Musashino Ramen",
      toName: "Inokashira Park",
      distanceMeters: 2000,
      walkingMinutes: 25,
      safetyConcern: true,
      safetyConcernName: "Roppongi",
      wgAvailable: true,
      note: null,
    };
    const day0 = mockItineraryResponse.days[0]!;
    const responseWithSafety = {
      ...mockItineraryResponse,
      days: [
        {
          ...day0,
          segments: day0.segments.map((s) =>
            s.segmentType === "route" ? { ...s, payload: safetyRoutePayload } : s
          ),
        },
        ...mockItineraryResponse.days.slice(1),
      ],
    };

    await page.route(`/api/itinerary?tripId=${TRIP_ID}`, (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(emptyItineraryResponse),
      });
    });

    await page.route("/api/itinerary", (route) => {
      if (route.request().method() === "POST") {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(responseWithSafety),
        });
      }
    });

    await page.goto(`/trip/${TRIP_ID}/itinerary`);
    await page.getByTestId("build-itinerary-btn").click();

    await expect(page.getByTestId("itinerary-days")).toBeVisible();
    await expect(page.getByText("Roppongi")).toBeVisible();
  });

  test("recompute replaces the itinerary with fresh data", async ({ page }) => {
    const updatedResponse = {
      ...mockItineraryResponse,
      days: [
        {
          ...mockItineraryResponse.days[0]!,
          segments: [
            {
              id: 10,
              dayId: 1,
              order: "a",
              segmentType: "place" as const,
              placeId: 20,
              adjustmentState: "scheduled",
              startTime: null,
              endTime: null,
              payload: { category: "eat", placeName: "New Ramen Shop", worthTheDetour: false },
            },
          ],
          routes: [],
        },
      ],
    };

    let postCount = 0;
    await page.route(`/api/itinerary?tripId=${TRIP_ID}`, (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(emptyItineraryResponse),
      });
    });

    await page.route("/api/itinerary", (route) => {
      if (route.request().method() === "POST") {
        postCount++;
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(postCount === 1 ? mockItineraryResponse : updatedResponse),
        });
      }
    });

    await page.goto(`/trip/${TRIP_ID}/itinerary`);

    // First build
    await page.getByTestId("build-itinerary-btn").click();
    await expect(page.getByText("Musashino Ramen")).toBeVisible();

    // Recompute
    await page.getByTestId("build-itinerary-btn").click();
    await expect(page.getByText("New Ramen Shop")).toBeVisible();
    await expect(page.getByText("Musashino Ramen")).not.toBeVisible();
  });
});
