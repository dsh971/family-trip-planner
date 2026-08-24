// Shared between src/app/page.tsx (reads it to recognize a returning
// traveler) and src/app/profile/page.tsx (writes it on trip creation). No
// auth/session system exists in this app, so localStorage is the only
// client-side place to remember "the trip this browser is working on"
// between visits.
//
// Wrapped in try/catch rather than called directly: localStorage access can
// throw in real browsers (private browsing, storage disabled by policy,
// quota exceeded) — this degrades to "no active trip" instead of crashing
// Home or blocking trip creation over a non-essential convenience feature.
const ACTIVE_TRIP_STORAGE_KEY = "activeTripId";

export function getActiveTripId(): string | null {
  try {
    return window.localStorage.getItem(ACTIVE_TRIP_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setActiveTripId(tripId: number): void {
  try {
    window.localStorage.setItem(ACTIVE_TRIP_STORAGE_KEY, String(tripId));
  } catch {
    // Non-essential — Home simply won't recognize this trip on a return visit.
  }
}

export function clearActiveTripId(): void {
  try {
    window.localStorage.removeItem(ACTIVE_TRIP_STORAGE_KEY);
  } catch {
    // Non-essential — see setActiveTripId.
  }
}
