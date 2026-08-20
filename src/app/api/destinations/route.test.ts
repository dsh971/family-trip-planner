import { describe, it, expect, vi, beforeEach } from "vitest";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import Database from "better-sqlite3";
import * as schema from "@/db/schema";
import path from "path";

const MIGRATIONS_FOLDER = path.resolve(__dirname, "../../../db/migrations");

function createDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db;
}

type Db = ReturnType<typeof createDb>;

function seedDestination(db: Db, overrides: Partial<typeof schema.destinations.$inferInsert> = {}) {
  return db
    .insert(schema.destinations)
    .values({
      slug: "kyoto",
      name: "Kyoto",
      country: "Japan",
      defaultWalkingRadiusMeters: 1200,
      localeValidators: [],
      safetyDataSource: "",
      ...overrides,
    })
    .returning()
    .all()[0]!;
}

// We mock @/db/client so the route uses our in-memory DB
vi.mock("@/db/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/db/client")>();
  return {
    ...original,
    getDb: vi.fn(),
  };
});

async function makeGetRequest(query: string) {
  const { GET } = await import("./route");
  const req = new Request(`http://localhost/api/destinations${query}`);
  return GET(req);
}

async function makePostRequest(body: Record<string, unknown>, ip = "203.0.113.1") {
  const { POST } = await import("./route");
  const req = new Request("http://localhost/api/destinations", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
  return POST(req);
}

describe("GET /api/destinations", () => {
  let db: Db;

  beforeEach(async () => {
    db = createDb();
    const { getDb } = await import("@/db/client");
    vi.mocked(getDb).mockReturnValue(db as ReturnType<typeof import("@/db/client").getDb>);
  });

  it("returns destinations whose name matches the query, case-insensitively", async () => {
    seedDestination(db, { slug: "kyoto", name: "Kyoto", country: "Japan" });
    seedDestination(db, { slug: "osaka", name: "Osaka", country: "Japan" });

    const res = await makeGetRequest("?q=kyo");

    expect(res.status).toBe(200);
    const json = await res.json() as Array<{ name: string }>;
    expect(json).toHaveLength(1);
    expect(json[0]!.name).toBe("Kyoto");
  });

  it("returns an empty list, not an error, when nothing matches", async () => {
    seedDestination(db, { slug: "kyoto", name: "Kyoto", country: "Japan" });

    const res = await makeGetRequest("?q=zzzznonexistent");

    expect(res.status).toBe(200);
    const json = await res.json() as unknown[];
    expect(json).toEqual([]);
  });

  it("returns an empty list, not an error, for a blank query", async () => {
    seedDestination(db, { slug: "kyoto", name: "Kyoto", country: "Japan" });

    const res = await makeGetRequest("?q=");

    expect(res.status).toBe(200);
    const json = await res.json() as unknown[];
    expect(json).toEqual([]);
  });

  it("limits results to at most 8 matches", async () => {
    for (let i = 0; i < 12; i++) {
      seedDestination(db, { slug: `city-${i}`, name: `Testville ${i}`, country: "Testland" });
    }

    const res = await makeGetRequest("?q=testville");

    const json = await res.json() as unknown[];
    expect(json.length).toBeLessThanOrEqual(8);
  });
});

describe("POST /api/destinations", () => {
  let db: Db;

  beforeEach(async () => {
    db = createDb();
    const { getDb } = await import("@/db/client");
    vi.mocked(getDb).mockReturnValue(db as ReturnType<typeof import("@/db/client").getDb>);
    const { _resetRateLimitForTesting } = await import("./route");
    _resetRateLimitForTesting();
  });

  it("creates a new destination when no match exists", async () => {
    const res = await makePostRequest({ name: "Lisbon", country: "Portugal" });

    expect(res.status).toBe(200);
    const json = await res.json() as { id: number; slug: string; researchStatus: string };
    expect(json.slug).toBe("lisbon");
    expect(json.researchStatus).toBe("not_started");

    const rows = db.select().from(schema.destinations).all();
    expect(rows).toHaveLength(1);
  });

  it("returns the existing row when one already matches, by normalized slug", async () => {
    const existing = seedDestination(db, { slug: "lisbon", name: "Lisbon", country: "Portugal" });

    const res = await makePostRequest({ name: "Lisbon" });

    expect(res.status).toBe(200);
    const json = await res.json() as { id: number };
    expect(json.id).toBe(existing.id);

    const rows = db.select().from(schema.destinations).all();
    expect(rows).toHaveLength(1);
  });

  it("resolves name variants ('Kyoto', 'kyoto', '  Kyoto  ') to the same row", async () => {
    const first = await (await makePostRequest({ name: "Kyoto" })).json() as { id: number };
    const second = await (await makePostRequest({ name: "kyoto" })).json() as { id: number };
    const third = await (await makePostRequest({ name: "  Kyoto  " })).json() as { id: number };

    expect(second.id).toBe(first.id);
    expect(third.id).toBe(first.id);

    const rows = db.select().from(schema.destinations).all();
    expect(rows).toHaveLength(1);
  });

  it("rejects an empty or whitespace-only name with a 400", async () => {
    const res = await makePostRequest({ name: "   " });

    expect(res.status).toBe(400);
    const json = await res.json() as { errors: Array<{ field: string }> };
    expect(json.errors.some((e) => e.field === "name")).toBe(true);
  });

  it("rejects requests beyond the per-IP rate limit with a 429", async () => {
    const ip = "198.51.100.7";
    let lastStatus = 200;

    for (let i = 0; i < 15; i++) {
      const res = await makePostRequest({ name: `City ${i}` }, ip);
      lastStatus = res.status;
    }

    expect(lastStatus).toBe(429);
  });

  it("does not rate limit a different IP after one IP is exhausted", async () => {
    const exhaustedIp = "198.51.100.8";
    for (let i = 0; i < 15; i++) {
      await makePostRequest({ name: `City ${i}` }, exhaustedIp);
    }

    const res = await makePostRequest({ name: "Fresh City" }, "198.51.100.9");
    expect(res.status).toBe(200);
  });
});
