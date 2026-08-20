#!/bin/sh
set -e

# Run DB migrations (idempotent — safe to run on every startup)
echo "==> Running database migrations..."
npx tsx src/db/migrate.ts

# Seed destination, neighborhood, and safety data (idempotent inserts) — a
# dev/demo fallback fixture, not the only path to a populated destination
# (see src/services/destinations/lookup.ts, plan 2026-08-20-011 U1).
echo "==> Seeding destination data..."
npx tsx src/db/seed.ts

# NOTE: Wanderlust GOAT's per-city sync ("wanderlust-goat-pp-cli sync-city") used
# to run here unconditionally for Tokyo at every startup. That was a hardcoded,
# single-destination assumption that doesn't hold once destinations are created
# dynamically (plan 2026-08-20-011 U2). Per-destination sync-city hydration is
# reintroduced as part of that destination's first neighborhood-discovery research
# pass in a later unit of that plan, not at container startup.

echo "==> Starting Next.js server on port ${PORT:-3000}..."
exec npm start
