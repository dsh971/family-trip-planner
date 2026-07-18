import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// We import after setting up env so the module sees the env var
const FAKE_API_KEY = "TEST_GOOGLE_KEY";

function makeRequest(params: Record<string, string> = {}) {
  const url = new URL("http://localhost/api/places/photo");
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return new Request(url.toString());
}

describe("GET /api/places/photo", () => {
  beforeEach(() => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", FAKE_API_KEY);
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns 400 when ref param is missing", async () => {
    const { GET } = await import("./route");
    const response = await GET(makeRequest());
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toEqual({ error: "ref is required" });
  });

  it("returns 400 when ref param is an empty string", async () => {
    const { GET } = await import("./route");
    const response = await GET(makeRequest({ ref: "" }));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toEqual({ error: "ref is required" });
  });

  it("fetches upstream with correct URL and streams back the response", async () => {
    const fakeBody = new ReadableStream();
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(
      new Response(fakeBody, {
        status: 200,
        headers: { "Content-Type": "image/jpeg" },
      })
    );

    const { GET } = await import("./route");
    const response = await GET(makeRequest({ ref: "PHOTO_REF_123", maxWidth: "600" }));

    expect(mockFetch).toHaveBeenCalledOnce();
    const calledUrl = mockFetch.mock.calls[0]![0] as string;
    expect(calledUrl).toContain("photo_reference=PHOTO_REF_123");
    expect(calledUrl).toContain("maxwidth=600");
    expect(calledUrl).toContain(`key=${FAKE_API_KEY}`);
    expect(calledUrl).toMatch(/^https:\/\/maps\.googleapis\.com\/maps\/api\/place\/photo/);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/jpeg");
  });

  it("uses default maxWidth of 800 when maxWidth param is omitted", async () => {
    const fakeBody = new ReadableStream();
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(
      new Response(fakeBody, {
        status: 200,
        headers: { "Content-Type": "image/jpeg" },
      })
    );

    const { GET } = await import("./route");
    await GET(makeRequest({ ref: "PHOTO_REF_ABC" }));

    const calledUrl = mockFetch.mock.calls[0]![0] as string;
    expect(calledUrl).toContain("maxwidth=800");
  });

  it("falls back to image/jpeg Content-Type when upstream omits it", async () => {
    const fakeBody = new ReadableStream();
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(
      new Response(fakeBody, { status: 200 })
    );

    const { GET } = await import("./route");
    const response = await GET(makeRequest({ ref: "REF_NO_CT" }));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/jpeg");
  });

  it("returns 502 when upstream responds with a non-2xx status", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(
      new Response(null, { status: 403 })
    );

    const { GET } = await import("./route");
    const response = await GET(makeRequest({ ref: "BAD_REF" }));

    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body).toEqual({ error: "upstream error" });
  });

  it("does not expose the API key in any response header", async () => {
    const fakeBody = new ReadableStream();
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(
      new Response(fakeBody, {
        status: 200,
        headers: { "Content-Type": "image/jpeg" },
      })
    );

    const { GET } = await import("./route");
    const response = await GET(makeRequest({ ref: "PHOTO_REF_SAFE" }));

    const headerValues = [...response.headers.entries()]
      .map(([, v]) => v)
      .join(" ");
    expect(headerValues).not.toContain(FAKE_API_KEY);
  });
});
