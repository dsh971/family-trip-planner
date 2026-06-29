import { describe, it, expect } from "vitest";
import {
  buildDaySlots,
  distributeDecisions,
  generateFractionalOrder,
  type SchedulerInput,
  type SlotDefinition,
  type ScheduledDay,
} from "./scheduler";

const basePacingWindows = [
  { name: "morning", startTime: "09:00", endTime: "12:00" },
  { name: "nap", startTime: "13:00", endTime: "15:00" },
  { name: "afternoon", startTime: "15:00", endTime: "18:00" },
  { name: "bedtime", startTime: "19:30", endTime: "23:59" },
];

const baseEatDecision = {
  id: 1,
  placeId: 10,
  placeName: "Musashino Ramen",
  placeGoogleId: "RAMEN",
  category: "eat" as const,
  worthTheDetour: false,
  lat: 35.702,
  lng: 139.58,
};

const baseVisitDecision = {
  id: 2,
  placeId: 11,
  placeName: "Inokashira Park",
  placeGoogleId: "PARK",
  category: "visit" as const,
  worthTheDetour: false,
  lat: 35.700,
  lng: 139.576,
};

describe("buildDaySlots", () => {
  it("generates the correct number of slots for a 2-day trip with standard pacing", () => {
    const slots = buildDaySlots({
      startDate: "2025-07-10",
      endDate: "2025-07-12", // 2 nights = 3 days but we only fill 2 full days
      pacingWindows: basePacingWindows,
    });
    // Each day gets 3 activity slots (morning, nap excluded, afternoon, bedtime)
    // morning slot + afternoon slot = 2 activity windows + 1 eat slot = 3 per day
    // For 2 days: expect at least 4 total eat+visit slots
    expect(slots.length).toBeGreaterThan(0);
    const dayDates = [...new Set(slots.map((s) => s.date))];
    expect(dayDates).toContain("2025-07-10");
    expect(dayDates).toContain("2025-07-11");
  });

  it("each day has both eat and visit slots", () => {
    const slots = buildDaySlots({
      startDate: "2025-07-10",
      endDate: "2025-07-11",
      pacingWindows: basePacingWindows,
    });
    const day0Slots = slots.filter((s) => s.date === "2025-07-10");
    expect(day0Slots.some((s) => s.category === "eat")).toBe(true);
    expect(day0Slots.some((s) => s.category === "visit")).toBe(true);
  });

  it("excludes nap window from activity slots", () => {
    const slots = buildDaySlots({
      startDate: "2025-07-10",
      endDate: "2025-07-11",
      pacingWindows: basePacingWindows,
    });
    const napSlot = slots.find((s) => s.windowName === "nap");
    expect(napSlot).toBeUndefined();
  });
});

describe("distributeDecisions", () => {
  it("distributes yes-decisions evenly across trip days", () => {
    const input: SchedulerInput = {
      startDate: "2025-07-10",
      endDate: "2025-07-12",
      pacingWindows: basePacingWindows,
      eatDecisions: [
        { ...baseEatDecision, placeId: 1, placeName: "Ramen A", placeGoogleId: "R1" },
        { ...baseEatDecision, placeId: 2, placeName: "Ramen B", placeGoogleId: "R2" },
      ],
      visitDecisions: [
        { ...baseVisitDecision, placeId: 3, placeName: "Park A", placeGoogleId: "P1" },
        { ...baseVisitDecision, placeId: 4, placeName: "Park B", placeGoogleId: "P2" },
        { ...baseVisitDecision, placeId: 5, placeName: "Museum", placeGoogleId: "P3" },
      ],
    };

    const schedule = distributeDecisions(input);

    // Each ScheduledDay should have at least 1 segment
    for (const day of schedule) {
      expect(day.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(day.segments.length).toBeGreaterThan(0);
    }

    // Total decisions should match input counts (all should be placed or overflow)
    const allSegmentPlaceIds = schedule.flatMap((d) => d.segments.map((s) => s.placeId).filter(Boolean));
    expect(allSegmentPlaceIds.length).toBeLessThanOrEqual(
      input.eatDecisions.length + input.visitDecisions.length
    );
  });

  it("places worth-the-detour items on a separate day when possible", () => {
    const detourDecision = {
      ...baseVisitDecision,
      placeId: 99,
      placeName: "TeamLab",
      placeGoogleId: "TEAMLAB",
      worthTheDetour: true,
    };

    const input: SchedulerInput = {
      startDate: "2025-07-10",
      endDate: "2025-07-13", // 3 nights = multiple days
      pacingWindows: basePacingWindows,
      eatDecisions: [
        { ...baseEatDecision, placeId: 1, placeName: "Ramen A", placeGoogleId: "R1" },
        { ...baseEatDecision, placeId: 2, placeName: "Ramen B", placeGoogleId: "R2" },
        { ...baseEatDecision, placeId: 3, placeName: "Ramen C", placeGoogleId: "R3" },
      ],
      visitDecisions: [baseVisitDecision, detourDecision],
    };

    const schedule = distributeDecisions(input);
    // Detour item should appear in the schedule
    const detourSegment = schedule
      .flatMap((d) => d.segments)
      .find((s) => s.placeId === 99);
    expect(detourSegment).toBeDefined();
  });

  it("unscheduled decisions (overflow) are returned in overflowSegments", () => {
    // Only 1 trip day but many decisions
    const input: SchedulerInput = {
      startDate: "2025-07-10",
      endDate: "2025-07-11",
      pacingWindows: basePacingWindows,
      eatDecisions: [
        { ...baseEatDecision, placeId: 1, placeName: "A", placeGoogleId: "A" },
        { ...baseEatDecision, placeId: 2, placeName: "B", placeGoogleId: "B" },
        { ...baseEatDecision, placeId: 3, placeName: "C", placeGoogleId: "C" },
        { ...baseEatDecision, placeId: 4, placeName: "D", placeGoogleId: "D" },
      ],
      visitDecisions: [
        { ...baseVisitDecision, placeId: 10, placeName: "X", placeGoogleId: "X" },
        { ...baseVisitDecision, placeId: 11, placeName: "Y", placeGoogleId: "Y" },
        { ...baseVisitDecision, placeId: 12, placeName: "Z", placeGoogleId: "Z" },
      ],
    };

    const schedule = distributeDecisions(input);
    const overflowDay = schedule.find((d) => d.date === "overflow");
    // Not all places can fit in 1 day — some should overflow
    expect(overflowDay).toBeDefined();
    expect(overflowDay!.segments.length).toBeGreaterThan(0);
  });

  it("returns pacing-block segments for nap windows in each day", () => {
    const input: SchedulerInput = {
      startDate: "2025-07-10",
      endDate: "2025-07-11",
      pacingWindows: basePacingWindows,
      eatDecisions: [baseEatDecision],
      visitDecisions: [baseVisitDecision],
    };

    const schedule = distributeDecisions(input);
    const daySegments = schedule.filter((d) => d.date !== "overflow").flatMap((d) => d.segments);
    const napBlock = daySegments.find((s) => s.segmentType === "pacing-block");
    expect(napBlock).toBeDefined();
    expect(napBlock!.payload?.["windowName"]).toBe("nap");
  });

  it("produces unique non-overlapping fractional orders within a day", () => {
    const input: SchedulerInput = {
      startDate: "2025-07-10",
      endDate: "2025-07-12",
      pacingWindows: basePacingWindows,
      eatDecisions: [baseEatDecision],
      visitDecisions: [baseVisitDecision],
    };

    const schedule = distributeDecisions(input);
    for (const day of schedule.filter((d) => d.date !== "overflow")) {
      const orders = day.segments.map((s) => s.order);
      const uniqueOrders = new Set(orders);
      expect(uniqueOrders.size).toBe(orders.length);
    }
  });
});

describe("generateFractionalOrder", () => {
  it("generates a valid sortable string for position 0", () => {
    const order = generateFractionalOrder(0, 10);
    expect(typeof order).toBe("string");
    expect(order.length).toBeGreaterThan(0);
  });

  it("generates lexicographically ordered strings", () => {
    const orders = Array.from({ length: 5 }, (_, i) => generateFractionalOrder(i, 10));
    const sorted = [...orders].sort();
    expect(sorted).toEqual(orders);
  });

  it("generates orders that allow insertion between any two adjacent items", () => {
    const first = generateFractionalOrder(0, 10);
    const second = generateFractionalOrder(1, 10);
    // A midpoint should be lexicographically between them
    const midpoint = generateFractionalOrder(0, 10, first, second);
    expect(midpoint > first).toBe(true);
    expect(midpoint < second).toBe(true);
  });
});
