// Itinerary scheduling engine (U8, KTD-F, KTD-K).
// Distributes yes-decisions across trip days honoring pacing windows.
// Each day gets: pacing-block for nap, eat slots, and visit slots derived
// from non-nap windows. Overflow decisions are returned on a synthetic
// "overflow" day for display as "unscheduled" items.

export interface PacingWindow {
  name: string;
  startTime: string;
  endTime: string;
}

export interface DecisionItem {
  id: number;
  placeId: number;
  placeName: string | null;
  placeGoogleId: string | null;
  category: "eat" | "visit";
  worthTheDetour: boolean;
  lat: number | null;
  lng: number | null;
}

export interface SlotDefinition {
  date: string;
  windowName: string;
  category: "eat" | "visit";
  startTime: string;
  endTime: string;
}

export interface SchedulerInput {
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD (exclusive — arrival day)
  pacingWindows: PacingWindow[];
  eatDecisions: DecisionItem[];
  visitDecisions: DecisionItem[];
}

export interface SegmentSpec {
  order: string;
  segmentType: "place" | "pacing-block";
  placeId: number | null;
  adjustmentState: "scheduled" | "unscheduled-today";
  startTime: string | null;
  endTime: string | null;
  payload: Record<string, unknown> | null;
}

export interface ScheduledDay {
  date: string; // YYYY-MM-DD or "overflow"
  segments: SegmentSpec[];
}

// Returns a lexicographically-sorted fractional order string at position `index`
// among `total` items. Optionally clamps to (before, after) when inserting mid-list.
export function generateFractionalOrder(
  index: number,
  total: number,
  before?: string,
  after?: string
): string {
  if (before !== undefined && after !== undefined) {
    // Midpoint between two strings using character code arithmetic
    const pad = Math.max(before.length, after.length) + 2;
    const b = before.padEnd(pad, "0").split("").map((c) => c.charCodeAt(0));
    const a = after.padEnd(pad, "0").split("").map((c) => c.charCodeAt(0));
    const mid = b.map((v, i) => Math.floor((v + (a[i] ?? 0)) / 2));
    return mid.map((c) => String.fromCharCode(c)).join("").trimEnd() || String.fromCharCode(Math.floor(("0".charCodeAt(0) + before.charCodeAt(0)) / 2));
  }

  // Evenly distributed keys in printable ASCII range (0x30 '0' → 0x7A 'z')
  const range = 0x7a - 0x30;
  const step = Math.max(1, Math.floor(range / (total + 1)));
  const code = 0x30 + step * (index + 1);
  return String.fromCharCode(Math.min(0x7a, code));
}

function datesBetween(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const current = new Date(startDate + "T00:00:00Z");
  const end = new Date(endDate + "T00:00:00Z");
  while (current < end) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

// Determine how many eat and visit slots are available per day given pacing windows.
// Convention:
//   - morning window: 1 visit slot
//   - afternoon window: 1 visit slot + 1 eat slot (lunch or dinner after sightseeing)
//   - bedtime window contributes 1 eat slot (dinner)
//   - nap window: pacing-block only, no activity slots
function slotsForWindows(pacingWindows: PacingWindow[]): { eat: number; visit: number } {
  let eat = 0;
  let visit = 0;
  for (const w of pacingWindows) {
    if (w.name === "nap" || w.name === "bedtime") continue;
    if (w.name === "morning") { visit += 1; eat += 1; }
    if (w.name === "afternoon") { visit += 1; eat += 1; }
  }
  // Always at least 1 eat + 1 visit per day
  return { eat: Math.max(1, eat), visit: Math.max(1, visit) };
}

// Build the full slot grid across all trip days.
export function buildDaySlots(params: {
  startDate: string;
  endDate: string;
  pacingWindows: PacingWindow[];
}): SlotDefinition[] {
  const dates = datesBetween(params.startDate, params.endDate);
  const slots: SlotDefinition[] = [];

  for (const date of dates) {
    let addedEat = false;
    for (const w of params.pacingWindows) {
      if (w.name === "nap") continue; // nap → pacing-block only
      if (w.name === "bedtime") {
        // Dinner slot
        slots.push({ date, windowName: w.name, category: "eat", startTime: w.startTime, endTime: w.endTime });
        continue;
      }
      // Morning / afternoon → visit + eat (lunch)
      slots.push({ date, windowName: w.name, category: "visit", startTime: w.startTime, endTime: w.endTime });
      if (!addedEat) {
        // One eat slot per morning/afternoon pair
        slots.push({ date, windowName: w.name + "-meal", category: "eat", startTime: w.startTime, endTime: w.endTime });
        addedEat = true;
      }
    }
  }

  return slots;
}

// Assign decisions to slots round-robin across days.
// Worth-the-detour places are deferred to their own day if capacity allows.
export function distributeDecisions(input: SchedulerInput): ScheduledDay[] {
  const dates = datesBetween(input.startDate, input.endDate);
  const { eat: eatPerDay, visit: visitPerDay } = slotsForWindows(input.pacingWindows);

  // Separate detour and non-detour visits
  const regularVisits = input.visitDecisions.filter((d) => !d.worthTheDetour);
  const detourVisits = input.visitDecisions.filter((d) => d.worthTheDetour);

  // Build queue: interleave eat and regular visit per day, detour visits last
  const eatQueue = [...input.eatDecisions];
  const visitQueue = [...regularVisits, ...detourVisits];

  const dayMap = new Map<string, SegmentSpec[]>();
  for (const date of dates) {
    dayMap.set(date, []);
  }

  // Fill eat slots
  for (const date of dates) {
    const segs = dayMap.get(date)!;
    for (let i = 0; i < eatPerDay && eatQueue.length > 0; i++) {
      const d = eatQueue.shift()!;
      segs.push({
        order: generateFractionalOrder(segs.length, eatPerDay + visitPerDay + 1),
        segmentType: "place",
        placeId: d.placeId,
        adjustmentState: "scheduled",
        startTime: null,
        endTime: null,
        payload: { category: "eat", placeName: d.placeName, worthTheDetour: d.worthTheDetour },
      });
    }
  }

  // Fill visit slots
  for (const date of dates) {
    const segs = dayMap.get(date)!;
    for (let i = 0; i < visitPerDay && visitQueue.length > 0; i++) {
      const d = visitQueue.shift()!;
      segs.push({
        order: generateFractionalOrder(segs.length, eatPerDay + visitPerDay + 2),
        segmentType: "place",
        placeId: d.placeId,
        adjustmentState: "scheduled",
        startTime: null,
        endTime: null,
        payload: { category: "visit", placeName: d.placeName, worthTheDetour: d.worthTheDetour },
      });
    }
  }

  // Insert pacing-block for nap window into each day
  const napWindow = input.pacingWindows.find((w) => w.name === "nap");
  if (napWindow) {
    for (const date of dates) {
      const segs = dayMap.get(date)!;
      segs.push({
        order: generateFractionalOrder(segs.length, segs.length + 2),
        segmentType: "pacing-block",
        placeId: null,
        adjustmentState: "scheduled",
        startTime: napWindow.startTime,
        endTime: napWindow.endTime,
        payload: { windowName: "nap", label: "Nap / rest time" },
      });
    }
  }

  // Ensure unique orders within each day
  for (const [, segs] of dayMap) {
    segs.forEach((seg, idx) => {
      seg.order = generateFractionalOrder(idx, segs.length + 1);
    });
  }

  // Remaining unplaced decisions → overflow day
  const overflow: SegmentSpec[] = [];
  for (const d of [...eatQueue, ...visitQueue]) {
    overflow.push({
      order: generateFractionalOrder(overflow.length, Math.max(10, overflow.length + 1)),
      segmentType: "place",
      placeId: d.placeId,
      adjustmentState: "unscheduled-today",
      startTime: null,
      endTime: null,
      payload: { category: d.category, placeName: d.placeName, worthTheDetour: d.worthTheDetour },
    });
  }

  const result: ScheduledDay[] = dates.map((date) => ({
    date,
    segments: dayMap.get(date) ?? [],
  }));

  if (overflow.length > 0) {
    result.push({ date: "overflow", segments: overflow });
  }

  return result;
}
