import { NextResponse } from "next/server";
import { like } from "drizzle-orm";
import { getDb } from "@/db/client";
import { destinations } from "@/db/schema";
import { findOrCreateDestination, InvalidDestinationNameError } from "@/services/destinations/lookup";

// U3 (plan 2026-08-20-011): search-as-you-type + lookup-or-create for
// destinations, replacing the free-text-only stopgap that U2 wired directly
// into POST /api/trips. That trips-route path (findOrCreateDestination call
// in src/app/api/trips/route.ts) is left in place as a fallback for callers
// that skip the search UI entirely (e.g. submitting a novel name with no
// selected suggestion) — this route is the dedicated, rate-limited surface
// R1/R2 ask for.

const SEARCH_RESULTS_LIMIT = 8;

// GET /api/destinations?q=<query> — existing-destination suggestions for
// search-as-you-type. Case-insensitive substring match on name; SQLite's
// LIKE is case-insensitive for ASCII by default (no PRAGMA case_sensitive_like
// is set anywhere in this codebase), so a plain `like()` is sufficient here.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();

  if (!q) {
    return NextResponse.json([]);
  }

  const db = getDb();
  const matches = db
    .select()
    .from(destinations)
    .where(like(destinations.name, `%${q}%`))
    .limit(SEARCH_RESULTS_LIMIT)
    .all();

  return NextResponse.json(matches);
}

// --- Per-IP rate limiting for POST -----------------------------------------
// POST is unauthenticated and can trigger real external API cost via the
// (not-yet-built) research pipeline once U5/U6 land, so it gets a simple
// fixed-window per-IP counter — no new dependency, kept local to this file
// per the plan's guidance (no shared rate-limit infra exists yet).
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 10;

const rateLimitState = new Map<string, { count: number; windowStart: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitState.get(ip);
  if (!entry || now - entry.windowStart >= RATE_LIMIT_WINDOW_MS) {
    rateLimitState.set(ip, { count: 1, windowStart: now });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT_MAX_REQUESTS;
}

// Test-only escape hatch, mirroring src/services/wanderlust-goat/client.ts's
// _resetAvailabilityForTesting() pattern for module-level state.
export function _resetRateLimitForTesting(): void {
  rateLimitState.clear();
}

function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]!.trim();
  }
  return "unknown";
}

// POST /api/destinations — lookup-or-create by (normalized) name. Reuses
// U1's findOrCreateDestination for the actual normalize-and-slug logic;
// this route only adds the HTTP/rate-limit shell around it.
export async function POST(request: Request) {
  const ip = getClientIp(request);
  if (isRateLimited(ip)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const bodyObj = body as Record<string, unknown>;
  const name = typeof bodyObj.name === "string" ? bodyObj.name : "";
  const country = typeof bodyObj.country === "string" ? bodyObj.country : undefined;

  const db = getDb();
  try {
    const destination = findOrCreateDestination(db, { name, country });
    return NextResponse.json(destination, { status: 200 });
  } catch (err) {
    if (err instanceof InvalidDestinationNameError) {
      return NextResponse.json(
        { errors: [{ field: "name", message: err.message }] },
        { status: 400 }
      );
    }
    throw err;
  }
}
