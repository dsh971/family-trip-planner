import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkDetourViability, buildNeighborhoodAnchor, derivePacingBudget } from "./detour";
import { WGUnavailableError } from "@/services/wanderlust-goat/types";

vi.mock("@/services/wanderlust-goat/client", () => ({
  routeView: vi.fn(),
  checkAvailability: vi.fn(),
}));

import { routeView } from "@/services/wanderlust-goat/client";
const routeViewMock = vi.mocked(routeView);

const baseInput = {
  fromName: "Hotel Century Southern Tower, Shinjuku, Tokyo, Japan",
  toName: "TeamLab Borderless, Toyosu, Tokyo, Japan",
  pacingBudgetMinutes: 45,
};

const mockAnchor = (query: string) => ({
  query,
  lat: 35.68,
  lng: 139.69,
  country: "JP",
  display: query,
  city: "Tokyo",
});

describe("checkDetourViability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns viable: true when walking_minutes is within pacing budget", async () => {
    routeViewMock.mockResolvedValueOnce({
      from: mockAnchor(baseInput.fromName),
      to: mockAnchor(baseInput.toName),
      buffer_meters: 200,
      distance_meters: 3200,
      walking_minutes: 30,
      along_route: null,
      note: "ok",
    });

    const result = await checkDetourViability(baseInput);
    expect(result.viable).toBe(true);
    expect(result.walkingMinutes).toBe(30);
    expect(result.wgAvailable).toBe(true);
  });

  it("returns viable: false when walking_minutes exceeds pacing budget", async () => {
    routeViewMock.mockResolvedValueOnce({
      from: mockAnchor(baseInput.fromName),
      to: mockAnchor(baseInput.toName),
      buffer_meters: 200,
      distance_meters: 8000,
      walking_minutes: 70,
      along_route: null,
      note: "ok",
    });

    const result = await checkDetourViability({ ...baseInput, pacingBudgetMinutes: 45 });
    expect(result.viable).toBe(false);
    expect(result.walkingMinutes).toBe(70);
  });

  it("returns viable: false when walking_minutes is null (route found but time unknown)", async () => {
    routeViewMock.mockResolvedValueOnce({
      from: mockAnchor(baseInput.fromName),
      to: mockAnchor(baseInput.toName),
      buffer_meters: 200,
      distance_meters: 15000,
      walking_minutes: null,
      along_route: null,
      note: "Ferry crossing required",
    });

    const result = await checkDetourViability(baseInput);
    expect(result.viable).toBe(false);
    expect(result.note).toBe("Ferry crossing required");
    expect(result.wgAvailable).toBe(true);
  });

  it("gracefully degrades when WG is unavailable — returns viable: true", async () => {
    routeViewMock.mockRejectedValueOnce(new WGUnavailableError());

    const result = await checkDetourViability(baseInput);
    expect(result.viable).toBe(true);
    expect(result.wgAvailable).toBe(false);
    expect(result.note).toContain("unavailable");
  });

  it("rethrows non-WG errors", async () => {
    routeViewMock.mockRejectedValueOnce(new Error("network timeout"));

    await expect(checkDetourViability(baseInput)).rejects.toThrow("network timeout");
  });

  it("applies HARD_WALKING_CAP_MINUTES even if pacing budget is generous", async () => {
    routeViewMock.mockResolvedValueOnce({
      from: mockAnchor(baseInput.fromName),
      to: mockAnchor(baseInput.toName),
      buffer_meters: 200,
      distance_meters: 20000,
      walking_minutes: 90, // above hard cap of 60
      along_route: null,
      note: "long route",
    });

    // pacing budget of 120 minutes is permissive, but hard cap at 60 overrides
    const result = await checkDetourViability({ ...baseInput, pacingBudgetMinutes: 120 });
    expect(result.viable).toBe(false);
    expect(result.walkingMinutes).toBe(90);
  });
});

describe("buildNeighborhoodAnchor", () => {
  it("formats Kichijoji anchor correctly", () => {
    expect(buildNeighborhoodAnchor("Kichijoji")).toBe("Kichijoji, Tokyo, Japan");
  });

  it("allows custom city and country", () => {
    expect(buildNeighborhoodAnchor("Shibuya", "Tokyo", "Japan")).toBe("Shibuya, Tokyo, Japan");
  });
});

describe("derivePacingBudget", () => {
  it("returns 45 when no pacing windows are defined", () => {
    expect(derivePacingBudget([])).toBe(45);
  });

  it("returns 45 when only nap window is defined but no bedtime", () => {
    expect(derivePacingBudget([{ name: "nap", startTime: "13:00", endTime: "15:00" }])).toBe(45);
  });

  it("derives budget from nap end to bedtime when both are defined", () => {
    const windows = [
      { name: "nap", startTime: "13:00", endTime: "15:00" },
      { name: "bedtime", startTime: "19:30", endTime: "23:59" },
    ];
    // Free minutes = 19:30 - 15:00 = 270, budget = 270 / 4 = 67, capped at 60
    const budget = derivePacingBudget(windows);
    expect(budget).toBe(60);
  });

  it("enforces minimum of 20 minutes when free time is very tight", () => {
    const windows = [
      { name: "nap", startTime: "13:00", endTime: "14:00" },
      { name: "bedtime", startTime: "14:30", endTime: "23:59" },
    ];
    // Free minutes = 30, budget = 30 / 4 = 7, clamped to minimum 20
    expect(derivePacingBudget(windows)).toBe(20);
  });
});
