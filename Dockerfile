# ── Stage 1: Compile Wanderlust GOAT binary ────────────────────────────────
# The WG binary has no pre-built release — it must be compiled from Go source
# via the printing-press-library npm installer. We use golang:1.26-alpine here
# so the Go toolchain is available for that compilation step.
FROM golang:1.26-alpine AS wg-builder

RUN apk add --no-cache nodejs npm

WORKDIR /build

# Compile the WG binary from Go source.
# The installer places the binary at /usr/local/bin/wanderlust-goat-pp-cli.
RUN npx -y @mvanhorn/printing-press-library install wanderlust-goat --cli-only

# ── Stage 2: App runtime ────────────────────────────────────────────────────
FROM node:22-alpine AS runner

# Copy compiled WG binary from builder stage
COPY --from=wg-builder /usr/local/bin/wanderlust-goat-pp-cli /usr/local/bin/wanderlust-goat-pp-cli

# WG writes its data cache and config at these paths at runtime.
# sync-city populates the cache; both must be writable in the container.
# Mount /root/.local/share/wanderlust-goat-pp-cli as a named volume in
# production to persist the synced place data across restarts.
RUN mkdir -p /root/.local/share/wanderlust-goat-pp-cli \
             /root/.config/wanderlust-goat-pp-cli

# Persistent directory for the SQLite database
RUN mkdir -p /data

WORKDIR /app

# Install production dependencies (tsx is in dependencies, not devDependencies,
# because the entrypoint calls it to run migrate.ts and seed.ts at startup)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source — needed for:
#   src/db/migrations/  (Drizzle migrate reads these)
#   src/db/migrate.ts + seed.ts (run via tsx in entrypoint)
#   src/data/           (seed.ts reads destination/neighborhood/safety JSON)
#   src/app/ + rest     (Next.js build)
COPY . .

RUN npm run build

EXPOSE 3000

COPY scripts/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV DATABASE_URL=/data/local.db
ENV NODE_ENV=production
ENV PORT=3000

ENTRYPOINT ["/entrypoint.sh"]
