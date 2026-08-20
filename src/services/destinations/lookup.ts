import { eq } from "drizzle-orm";
import type { getDb } from "@/db/client";
import { destinations, type Destination } from "@/db/schema";

export class InvalidDestinationNameError extends Error {
  constructor() {
    super("Destination name must not be empty.");
    this.name = "InvalidDestinationNameError";
  }
}

// Normalizes a free-text destination name into a URL/slug-safe, stable key:
// lowercase, trim, collapse internal whitespace to single hyphens, strip
// punctuation. Two near-duplicate entries ("Kyoto", "kyoto", "  Kyoto  ")
// resolve to the same slug so U3's search-as-you-type flow can share one
// cached research record instead of fragmenting it (R2).
export function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]+/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export interface FindOrCreateDestinationInput {
  name: string;
  // Optional — the free-text entry flow (U3) doesn't necessarily collect a
  // country. Left blank rather than guessed; a later unit (U3 route, or a
  // geocoding follow-up) can populate it. Not a blocker for U1 — see plan
  // docs/plans/2026-08-20-011-feat-dynamic-destination-research-rewrite-plan.md, U1.
  country?: string;
}

// Looks up a destinations row by normalized slug, creating one on demand if
// none exists (R1: the app accepts any destination as input, not just the
// seeded row). New rows get researchStatus's schema default ("not_started")
// — no neighborhood-discovery research has run for them yet (U5 owns that).
export function findOrCreateDestination(
  db: ReturnType<typeof getDb>,
  input: FindOrCreateDestinationInput
): Destination {
  const name = input.name.trim().replace(/\s+/g, " ");
  const slug = slugify(name);
  if (!name || !slug) {
    throw new InvalidDestinationNameError();
  }

  const existing = db
    .select()
    .from(destinations)
    .where(eq(destinations.slug, slug))
    .all();
  if (existing.length > 0) {
    return existing[0]!;
  }

  try {
    const rows = db
      .insert(destinations)
      .values({
        slug,
        name,
        // TODO(follow-up unit): country isn't captured by the free-text entry
        // flow yet — left blank rather than guessed until U3's UI or a
        // geocoding lookup can supply a real value.
        country: input.country?.trim() ?? "",
        // No WG Stage-2 validators known for a destination we haven't
        // researched yet; U5's first research pass can populate this.
        localeValidators: [],
        // TODO(follow-up unit): no safety-report citation exists for a newly
        // created destination yet. Flagged per plan U1 approach — not a
        // blocker for this unit.
        safetyDataSource: "TODO: no safety data source yet for this destination",
      })
      .returning()
      .all();
    return rows[0]!;
  } catch (err) {
    // Two concurrent callers can both pass the SELECT above and race to
    // insert the same slug; the unique index (destinations.slug) will reject
    // the loser. Re-read instead of failing — the winner's row is what both
    // callers want.
    const retry = db
      .select()
      .from(destinations)
      .where(eq(destinations.slug, slug))
      .all();
    if (retry.length > 0) {
      return retry[0]!;
    }
    throw err;
  }
}
