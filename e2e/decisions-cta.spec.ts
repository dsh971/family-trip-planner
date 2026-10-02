/**
 * E2E: Decisions page CTA clipping fix.
 *
 * docs/plans/2026-09-12-001-fix-design-audit-bugs-plan.md U4 — the "Build my
 * schedule" CTA rendered as a clipped sliver at the bottom of the mobile
 * viewport with enough cards in the active tab, sitting under the fixed
 * bottom nav. Fixed with a sticky CTA plus a padding move; these tests mock
 * /api/decisions so they don't require live API keys or seeded data.
 */

import { test, expect } from "@playwright/test";

const TRIP_ID = 1;

function decisionRow(id: number, category: "eat" | "visit", placeName: string) {
  return {
    id,
    placeId: id,
    category,
    decision: "yes",
    worthTheDetour: false,
    updatedAt: "2026-09-01T00:00:00.000Z",
    placeName,
    placeGoogleId: `place-${id}`,
    lat: 35.7 + id * 0.001,
    lng: 139.58 + id * 0.001,
    rating: 4.3,
    priceLevel: 2,
    photoReference: null,
  };
}

// 4 Eat-category decisions — the count that clipped the CTA under the fixed
// BottomNav before this fix, per the audit's own measurement. 2 Visit-
// category decisions so the pluralization test below actually exercises
// the plural branch.
const fourEatDecisions = {
  decisions: [
    decisionRow(1, "eat", "Niigata Katsudon"),
    decisionRow(2, "eat", "Corn Barley"),
    decisionRow(3, "eat", "Kayashima"),
    decisionRow(4, "eat", "Coco's Kichijoji"),
    decisionRow(5, "visit", "Inokashira Park"),
    decisionRow(6, "visit", "Kichijoji Art Museum"),
  ],
};

test.describe("Decisions page CTA", () => {
  test("mobile: CTA stays within the scroll viewport, never clipped by the bottom nav", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route(`/api/decisions?tripId=${TRIP_ID}`, (route) => {
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fourEatDecisions) });
    });

    await page.goto(`/trip/${TRIP_ID}/decisions`);
    const cta = page.getByRole("link", { name: "Build my schedule →" });
    await expect(cta).toBeVisible();

    const box = await cta.boundingBox();
    expect(box).not.toBeNull();
    // BottomNav is a fixed 64px bar at the viewport's bottom edge (see
    // AppHeader's 44px + BottomNav's 64px insets in globals.css's
    // .trip-shell-inset); the CTA must render fully above it.
    expect(box!.y + box!.height).toBeLessThanOrEqual(844 - 64);
  });

  test("mobile: the shorter Visit tab, which already cleared the nav before this fix, is unaffected", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route(`/api/decisions?tripId=${TRIP_ID}`, (route) => {
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fourEatDecisions) });
    });

    await page.goto(`/trip/${TRIP_ID}/decisions`);
    await page.getByRole("button", { name: /^Visit/ }).click();

    const cta = page.getByRole("link", { name: "Build my schedule →" });
    const box = await cta.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y + box!.height).toBeLessThanOrEqual(844 - 64);
  });

  test("desktop: CTA sits in flow at the end of the list column, not sticky", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.route(`/api/decisions?tripId=${TRIP_ID}`, (route) => {
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fourEatDecisions) });
    });

    await page.goto(`/trip/${TRIP_ID}/decisions`);
    const cta = page.getByRole("link", { name: "Build my schedule →" });
    await expect(cta).toBeVisible();

    const wrapper = page.locator(".decisions-cta-sticky");
    await expect(wrapper).toHaveCSS("position", "static");
  });

  test("pluralizes the Visit tab's selected count correctly", async ({ page }) => {
    await page.route(`/api/decisions?tripId=${TRIP_ID}`, (route) => {
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fourEatDecisions) });
    });

    await page.goto(`/trip/${TRIP_ID}/decisions`);
    await page.getByRole("button", { name: /^Visit/ }).click();

    await expect(page.getByText("activities selected")).toBeVisible();
    await expect(page.getByText("activitys selected")).toHaveCount(0);
  });
});
