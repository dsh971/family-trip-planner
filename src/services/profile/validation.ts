export interface PacingWindow {
  name: string;
  startTime: string; // "HH:MM"
  endTime: string; // "HH:MM"
}

export interface ProfileInput {
  adultCount: number;
  children: Array<{ age: number }>;
  dietaryTags: string[];
  accessibilityTags: string[];
  pacingWindows: PacingWindow[];
}

export interface TripInput {
  destinationId: number;
  startDate: string; // "YYYY-MM-DD"
  endDate: string; // "YYYY-MM-DD"
  hotelName?: string;
  hotelAddress?: string;
}

export interface ValidationError {
  field: string;
  message: string;
}

export interface ValidationResult<T> {
  valid: boolean;
  data?: T;
  errors: ValidationError[];
}

function parseTime(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function windowsOverlap(a: PacingWindow, b: PacingWindow): boolean {
  const aStart = parseTime(a.startTime);
  const aEnd = parseTime(a.endTime);
  const bStart = parseTime(b.startTime);
  const bEnd = parseTime(b.endTime);
  return aStart < bEnd && bStart < aEnd;
}

export function validateProfile(
  input: unknown
): ValidationResult<ProfileInput> {
  const errors: ValidationError[] = [];

  if (typeof input !== "object" || input === null) {
    return { valid: false, errors: [{ field: "root", message: "Expected an object" }] };
  }

  const data = input as Record<string, unknown>;

  if (typeof data.adultCount !== "number" || data.adultCount < 1) {
    errors.push({ field: "adultCount", message: "Must be at least 1" });
  }

  const children = Array.isArray(data.children) ? data.children : [];
  for (let i = 0; i < children.length; i++) {
    const child = children[i] as Record<string, unknown>;
    if (typeof child?.age !== "number" || child.age < 0 || child.age > 17) {
      errors.push({ field: `children[${i}].age`, message: "Child age must be 0-17" });
    }
  }

  const pacingWindows = Array.isArray(data.pacingWindows)
    ? (data.pacingWindows as PacingWindow[])
    : [];

  const timePattern = /^\d{2}:\d{2}$/;
  for (let i = 0; i < pacingWindows.length; i++) {
    const w = pacingWindows[i]!;
    if (!timePattern.test(w.startTime) || !timePattern.test(w.endTime)) {
      errors.push({ field: `pacingWindows[${i}]`, message: "Times must be HH:MM format" });
      continue;
    }
    if (parseTime(w.startTime) >= parseTime(w.endTime)) {
      errors.push({ field: `pacingWindows[${i}]`, message: "startTime must be before endTime" });
    }
  }

  // Check for overlapping pacing windows
  for (let i = 0; i < pacingWindows.length; i++) {
    for (let j = i + 1; j < pacingWindows.length; j++) {
      if (windowsOverlap(pacingWindows[i]!, pacingWindows[j]!)) {
        errors.push({
          field: "pacingWindows",
          message: `Windows "${pacingWindows[i]!.name}" and "${pacingWindows[j]!.name}" overlap — U8 requires non-overlapping pacing blocks`,
        });
      }
    }
  }

  if (errors.length > 0) return { valid: false, errors };

  return {
    valid: true,
    errors: [],
    data: {
      adultCount: data.adultCount as number,
      children: children as Array<{ age: number }>,
      dietaryTags: Array.isArray(data.dietaryTags) ? (data.dietaryTags as string[]) : [],
      accessibilityTags: Array.isArray(data.accessibilityTags) ? (data.accessibilityTags as string[]) : [],
      pacingWindows,
    },
  };
}

export function validateTrip(
  input: unknown
): ValidationResult<TripInput> {
  const errors: ValidationError[] = [];

  if (typeof input !== "object" || input === null) {
    return { valid: false, errors: [{ field: "root", message: "Expected an object" }] };
  }

  const data = input as Record<string, unknown>;

  if (typeof data.destinationId !== "number") {
    errors.push({ field: "destinationId", message: "Required" });
  }

  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (typeof data.startDate !== "string" || !datePattern.test(data.startDate)) {
    errors.push({ field: "startDate", message: "Must be YYYY-MM-DD" });
  }
  if (typeof data.endDate !== "string" || !datePattern.test(data.endDate)) {
    errors.push({ field: "endDate", message: "Must be YYYY-MM-DD" });
  }

  if (errors.length === 0) {
    if (data.endDate! <= data.startDate!) {
      errors.push({ field: "endDate", message: "End date must be after start date" });
    }
  }

  if (errors.length > 0) return { valid: false, errors };

  return {
    valid: true,
    errors: [],
    data: {
      destinationId: data.destinationId as number,
      startDate: data.startDate as string,
      endDate: data.endDate as string,
      hotelName: typeof data.hotelName === "string" ? data.hotelName : undefined,
      hotelAddress: typeof data.hotelAddress === "string" ? data.hotelAddress : undefined,
    },
  };
}
