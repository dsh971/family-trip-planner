import { describe, it, expect } from "vitest";
import { validateProfile, validateTrip } from "./validation";

describe("validateProfile", () => {
  it("accepts a valid profile and returns parsed data", () => {
    const result = validateProfile({
      adultCount: 2,
      children: [{ age: 4 }, { age: 7 }],
      dietaryTags: [],
      accessibilityTags: [],
      pacingWindows: [{ name: "nap", startTime: "13:00", endTime: "15:00" }],
    });
    expect(result.valid).toBe(true);
    expect(result.data?.adultCount).toBe(2);
    expect(result.data?.children).toHaveLength(2);
    expect(result.data?.pacingWindows[0]?.name).toBe("nap");
  });

  it("rejects a profile with no adults", () => {
    const result = validateProfile({ adultCount: 0, children: [], dietaryTags: [], accessibilityTags: [], pacingWindows: [] });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "adultCount")).toBe(true);
  });

  it("rejects a profile with invalid child age", () => {
    const result = validateProfile({ adultCount: 1, children: [{ age: 25 }], dietaryTags: [], accessibilityTags: [], pacingWindows: [] });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field.startsWith("children"))).toBe(true);
  });

  it("rejects overlapping pacing windows", () => {
    const result = validateProfile({
      adultCount: 2,
      children: [],
      dietaryTags: [],
      accessibilityTags: [],
      pacingWindows: [
        { name: "nap", startTime: "13:00", endTime: "15:00" },
        { name: "rest", startTime: "14:00", endTime: "16:00" },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "pacingWindows")).toBe(true);
  });

  it("accepts non-overlapping pacing windows", () => {
    const result = validateProfile({
      adultCount: 2,
      children: [],
      dietaryTags: [],
      accessibilityTags: [],
      pacingWindows: [
        { name: "nap", startTime: "13:00", endTime: "15:00" },
        { name: "bedtime", startTime: "19:30", endTime: "23:59" },
      ],
    });
    expect(result.valid).toBe(true);
  });

  it("rejects non-object input", () => {
    const result = validateProfile("not an object");
    expect(result.valid).toBe(false);
  });
});

describe("validateTrip", () => {
  const validTrip = {
    destinationId: 1,
    startDate: "2026-09-01",
    endDate: "2026-09-07",
  };

  it("accepts a valid trip with hotel address", () => {
    const result = validateTrip({ ...validTrip, hotelName: "Park Hyatt Tokyo", hotelAddress: "3-7-1-2 Nishi Shinjuku, Shinjuku" });
    expect(result.valid).toBe(true);
    expect(result.data?.hotelName).toBe("Park Hyatt Tokyo");
  });

  it("accepts a valid trip without hotel address (lodgingAnchor null path)", () => {
    const result = validateTrip(validTrip);
    expect(result.valid).toBe(true);
    expect(result.data?.hotelAddress).toBeUndefined();
  });

  it("rejects end date before start date", () => {
    const result = validateTrip({ ...validTrip, startDate: "2026-09-07", endDate: "2026-09-01" });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "endDate")).toBe(true);
  });

  it("rejects equal start and end dates", () => {
    const result = validateTrip({ ...validTrip, startDate: "2026-09-01", endDate: "2026-09-01" });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "endDate")).toBe(true);
  });

  it("rejects missing required fields", () => {
    const result = validateTrip({ startDate: "2026-09-01" });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "destinationId")).toBe(true);
    expect(result.errors.some((e) => e.field === "endDate")).toBe(true);
  });

  it("rejects malformed dates", () => {
    const result = validateTrip({ destinationId: 1, startDate: "Sep 1 2026", endDate: "September 7" });
    expect(result.valid).toBe(false);
  });
});
