#!/bin/sh
set -e

# Run DB migrations (idempotent — safe to run on every startup)
echo "==> Running database migrations..."
npx tsx src/db/migrate.ts

# Seed destination, neighborhood, and safety data (idempotent inserts)
echo "==> Seeding destination data..."
npx tsx src/db/seed.ts

# Sync Wanderlust GOAT place data for Tokyo.
# Required before route-view/crossover return populated results and before
# cross-source corroboration scores are non-zero (see curation engine plan).
# Runs every startup so the local store stays fresh; typically takes 2-5 min
# on first run and is faster on subsequent runs (incremental sync).
echo "==> Syncing Wanderlust GOAT city data for Tokyo (this may take a few minutes on first run)..."
if wanderlust-goat-pp-cli sync-city "Tokyo" --country JP; then
  echo "    sync-city completed successfully"
else
  echo "WARNING: sync-city failed — discovery/routing will run in degraded mode"
  echo "         (cross-source corroboration scores will be 0; Google Places only)"
fi

echo "==> Starting Next.js server on port ${PORT:-3000}..."
exec npm start
