import { describe, it, expect, vi, beforeEach } from "vitest";

describe("GET /api/places/photo", () => {
  beforeEach(() => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "test-key");
    vi.resetModules();
  });

  it("resolves photo reference and redirects to CDN URL", async () => {
    const cdnUrl = "https://lh3.googleusercontent.com/places/abc123";

    global.fetch = vi.fn().mockResolvedValueOnce({
      headers: { get: (k: string) => k === "location" ? cdnUrl : null },
    } as unknown as Response);

    const { GET } = await import("./route");
    const req = new Request("http://localhost/api/places/photo?ref=CmRaAAAAtest&width=200");
    const res = await GET(req);

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(cdnUrl);
  });

  it("returns 400 when ref query param is missing", async () => {
    const { GET } = await import("./route");
    const req = new Request("http://localhost/api/places/photo");
    const res = await GET(req);

    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("ref required");
  });

  it("returns 404 when photo cannot be resolved (no Location header)", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      headers: { get: () => null },
    } as unknown as Response);

    const { GET } = await import("./route");
    const req = new Request("http://localhost/api/places/photo?ref=bad-ref");
    const res = await GET(req);

    expect(res.status).toBe(404);
  });
});
