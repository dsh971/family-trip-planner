import { NextResponse } from "next/server";
import { geocodeCity } from "@/services/trips/geocoding";
import { createRateLimiter } from "@/lib/rateLimit";

// GET /api/geocode?city=<name>&country=<optional> — live "where is this on
// a map" preview for the Trip setup panel (TripSetupArt). Unauthenticated
// and fires on every keystroke pause (debounced client-side), so it gets
// the same shared-bucket rate limiting as /api/destinations POST — see
// src/lib/rateLimit.ts for why a single global counter, not per-IP.
const rateLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 30 });

// Test-only escape hatch, mirroring the same pattern in
// src/app/api/destinations/route.ts.
export function _resetRateLimitForTesting(): void {
  rateLimiter.reset();
}

export async function GET(request: Request) {
  if (rateLimiter.isRateLimited()) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const { searchParams } = new URL(request.url);
  const city = (searchParams.get("city") ?? "").trim();
  const country = searchParams.get("country")?.trim() || undefined;

  if (!city) {
    return NextResponse.json({ error: "city is required" }, { status: 400 });
  }

  try {
    const result = await geocodeCity(city, country);
    if (!result) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ lat: result.lat, lng: result.lng });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Geocoding failed" },
      { status: 502 }
    );
  }
}
