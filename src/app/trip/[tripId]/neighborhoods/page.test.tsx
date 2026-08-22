import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import NeighborhoodsPage from "./page";
import {
  installMockEventSource,
  latestEventSource,
  eventSourcesFor,
} from "@/test/mockEventSource";

// U7 (plan 2026-08-20-011): covers the origin doc's AE1 (brand-new
// destination: progressive skeleton fill alongside a highlight card) and
// AE2 (revisited, non-stale destination: full list immediately, no
// skeleton flash) scenarios, plus the manual re-research trigger.

vi.mock("next/navigation", () => ({
  useParams: () => ({ tripId: "1" }),
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/components/ui/NeighborhoodMap", () => ({
  default: () => <div data-testid="neighborhood-map" />,
}));

const TRIP = {
  id: 1,
  destinationId: 5,
  hotelName: null,
  lodgingAnchorLat: null,
  lodgingAnchorLng: null,
  startDate: "2026-09-01",
  endDate: "2026-09-05",
  familyProfile: { adultCount: 2, children: [] },
};

function neighborhoodRow(id: number, name: string) {
  return {
    id,
    destinationId: 5,
    name,
    centroidLat: 35.7,
    centroidLng: 139.7,
    walkingRadiusMeters: 900,
    familyFriendlinessScore: 80,
    dayInTheLifePreview: { highlights: ["Great parks"], safetyNote: "Safe area", sampleBundle: "Walk around" },
    sources: ["seed"],
  };
}

function rankedRow(id: number, name: string) {
  return {
    id,
    name,
    familyFriendlinessScore: 80,
    rankingScore: 80,
    safetyPenalty: 0,
    dayInTheLifePreview: { highlights: ["Great parks"], safetyNote: "Safe area", sampleBundle: "Walk around" },
    walkingRadiusMeters: 900,
    centroidLat: 35.7,
    centroidLng: 139.7,
  };
}

function mockFetch(handlers: {
  rankedNeighborhoods?: ReturnType<typeof rankedRow>[];
}) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url === "/api/trips/1") {
      return new Response(JSON.stringify(TRIP), { status: 200 });
    }
    if (url.startsWith("/api/neighborhoods?destinationId=")) {
      return new Response(JSON.stringify(handlers.rankedNeighborhoods ?? []), { status: 200 });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
}

beforeEach(() => {
  installMockEventSource();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("NeighborhoodsPage — U7 SSE progressive reveal", () => {
  it("AE2: a destination with complete cached data renders the full list immediately, no skeleton flash", async () => {
    global.fetch = mockFetch({
      rankedNeighborhoods: [rankedRow(1, "Shibuya"), rankedRow(2, "Asakusa")],
    }) as unknown as typeof fetch;

    render(<NeighborhoodsPage />);

    await waitFor(() => expect(eventSourcesFor("/api/destinations/5/research")).toHaveLength(1));

    // Cached fast-path: the route emits every persisted neighborhood then
    // "done" in one burst — simulated here as a single batch of dispatches.
    act(() => {
      const es = latestEventSource();
      es.emit("neighborhood", { type: "neighborhood", neighborhood: neighborhoodRow(1, "Shibuya") });
      es.emit("neighborhood", { type: "neighborhood", neighborhood: neighborhoodRow(2, "Asakusa") });
      es.emit("done", { researchStatus: "complete" });
    });

    await waitFor(() => expect(screen.getByText("Shibuya")).toBeTruthy());
    expect(screen.getByText("Asakusa")).toBeTruthy();
    expect(document.querySelectorAll(".animate-pulse")).toHaveLength(0);
  });

  it("AE1: a brand-new destination shows skeletons filling in progressively alongside a highlight card", async () => {
    global.fetch = mockFetch({ rankedNeighborhoods: [rankedRow(1, "Shibuya")] }) as unknown as typeof fetch;

    render(<NeighborhoodsPage />);

    await waitFor(() => expect(eventSourcesFor("/api/destinations/5/research")).toHaveLength(1));

    act(() => {
      latestEventSource().emit("highlight", {
        type: "highlight",
        destinationId: 5,
        text: "Tokyo blends ancient temples with neon-lit streets.",
      });
    });

    // Still researching: highlight visible, trailing skeleton placeholders present.
    await waitFor(() => expect(screen.getByText(/Tokyo blends ancient temples/)).toBeTruthy());
    expect(document.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);

    act(() => {
      latestEventSource().emit("neighborhood", { type: "neighborhood", neighborhood: neighborhoodRow(1, "Shibuya") });
    });

    // Real card renders progressively, real-content-backed (not a placeholder).
    await waitFor(() => expect(screen.getByText("Shibuya")).toBeTruthy());
    expect(document.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);

    act(() => {
      latestEventSource().emit("done", { researchStatus: "complete" });
    });

    await waitFor(() => expect(document.querySelectorAll(".animate-pulse")).toHaveLength(0));
  });

  it("manual trigger: clicking on a complete destination calls the route with force=true and transitions to researching; disabled while already researching", async () => {
    const user = userEvent.setup();
    global.fetch = mockFetch({ rankedNeighborhoods: [rankedRow(1, "Shibuya")] }) as unknown as typeof fetch;

    render(<NeighborhoodsPage />);

    await waitFor(() => expect(eventSourcesFor("/api/destinations/5/research")).toHaveLength(1));
    act(() => {
      const es = latestEventSource();
      es.emit("neighborhood", { type: "neighborhood", neighborhood: neighborhoodRow(1, "Shibuya") });
      es.emit("done", { researchStatus: "complete" });
    });
    await waitFor(() => expect(screen.getByText("Shibuya")).toBeTruthy());

    const trigger = screen.getByTitle("Re-check for updated neighborhood data");
    expect(trigger).not.toHaveProperty("disabled", true);

    await user.click(trigger);

    await waitFor(() =>
      expect(eventSourcesFor("/api/destinations/5/research?force=true")).toHaveLength(1)
    );

    // Now actively researching again — the button is disabled (no-op on further clicks).
    await waitFor(() => expect(trigger).toHaveProperty("disabled", true));
    await user.click(trigger);
    // Still exactly one forced connection — the second click was a no-op.
    expect(eventSourcesFor("/api/destinations/5/research?force=true")).toHaveLength(1);
  });

  // Testing gap closed (code review finding, 2026-08-21, testing P2): the
  // error-state Alert + retry action had no page-level test.
  it("error: the route's terminal error event shows an Alert with a retry action that reconnects", async () => {
    const user = userEvent.setup();
    global.fetch = mockFetch({}) as unknown as typeof fetch;

    render(<NeighborhoodsPage />);

    await waitFor(() => expect(eventSourcesFor("/api/destinations/5/research")).toHaveLength(1));

    act(() => {
      latestEventSource().emitNamedError({ message: "DB error" });
    });

    await waitFor(() => expect(screen.getByText("DB error")).toBeTruthy());

    await user.click(screen.getByText("Try again"));

    // retry() re-opens a fresh connection.
    await waitFor(() => expect(eventSourcesFor("/api/destinations/5/research")).toHaveLength(2));
  });

  // Testing gap closed (code review finding, 2026-08-21, testing P2): the
  // "partial" branch (some neighborhoods resolved, then the source failed)
  // had no page-level test — only "complete" was covered.
  it("partial: a run that resolves some neighborhoods then fails still shows the resolved results, not an error", async () => {
    global.fetch = mockFetch({
      rankedNeighborhoods: [rankedRow(1, "Shibuya")],
    }) as unknown as typeof fetch;

    render(<NeighborhoodsPage />);

    await waitFor(() => expect(eventSourcesFor("/api/destinations/5/research")).toHaveLength(1));

    act(() => {
      const es = latestEventSource();
      es.emit("neighborhood", { type: "neighborhood", neighborhood: neighborhoodRow(1, "Shibuya") });
      es.emit("partial", { researchStatus: "partial", error: "source failed" });
    });

    await waitFor(() => expect(screen.getByText("Shibuya")).toBeTruthy());
    expect(screen.queryByText(/Couldn't load neighborhoods/)).toBeNull();
  });
});
