import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import DiscoveryPage from "./page";
import {
  installMockEventSource,
  latestEventSource,
  eventSourcesFor,
} from "@/test/mockEventSource";

// U7 (plan 2026-08-20-011): covers the origin doc's AE1/AE2 wait-state
// distinction for the Discovery (place-research) page, mirroring the
// coverage in ../neighborhoods/page.test.tsx.

vi.mock("next/navigation", () => ({
  useParams: () => ({ tripId: "1" }),
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/components/ui/DiscoveryMap", () => ({
  default: () => <div data-testid="discovery-map" />,
}));

const TRIP = { id: 1, selectedNeighborhoodId: 7 };

function rawPlace(placeId: string, name: string) {
  return {
    placeId,
    name,
    category: "eat" as const,
    lat: 35.7,
    lng: 139.7,
    rating: 4.5,
    reviewCount: 120,
    priceLevel: 2,
    types: ["restaurant"],
    goodForChildren: true,
    menuForChildren: null,
    sources: ["google"],
    corroborationScore: 1,
    distanceFromCentroidMeters: 200,
    worthTheDetour: false,
    photoReference: null,
    description: null,
  };
}

function discoveryResponse(names: string[]) {
  return {
    neighborhoodId: 7,
    neighborhoodName: "Shibuya",
    results: names.map((n, i) => ({ ...rawPlace(`p${i}`, n), rankPosition: i + 1 })),
    wgAvailable: false,
    lodgingLat: null,
    lodgingLng: null,
    transitStations: [],
  };
}

function mockFetch(handlers: { discoveryResults?: ReturnType<typeof discoveryResponse> }) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url === "/api/trips/1") {
      return new Response(JSON.stringify(TRIP), { status: 200 });
    }
    if (url === "/api/discovery" && init?.method === "POST") {
      return new Response(
        JSON.stringify(handlers.discoveryResults ?? discoveryResponse([])),
        { status: 200 }
      );
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

describe("DiscoveryPage — U7 SSE progressive reveal", () => {
  it("AE2: cached/fresh neighborhood renders full content immediately, no skeleton flash", async () => {
    global.fetch = mockFetch({
      discoveryResults: discoveryResponse(["Ramen Ya", "Sushi Zen"]),
    }) as unknown as typeof fetch;

    render(<DiscoveryPage />);

    await waitFor(() => expect(eventSourcesFor("/api/neighborhoods/7/research")).toHaveLength(1));

    act(() => {
      const es = latestEventSource();
      es.emit("place", { type: "place", neighborhoodId: 7, place: rawPlace("p0", "Ramen Ya") });
      es.emit("place", { type: "place", neighborhoodId: 7, place: rawPlace("p1", "Sushi Zen") });
      es.emit("done", { researchStatus: "complete" });
    });

    // Finalize (POST /api/discovery) resolves quickly (mocked); final content appears.
    await waitFor(() => expect(screen.getByText("Ramen Ya")).toBeTruthy());
    expect(screen.getByText("Sushi Zen")).toBeTruthy();
    await waitFor(() => expect(document.querySelectorAll(".animate-pulse")).toHaveLength(0));
  });

  it("AE1: a brand-new neighborhood shows skeletons filling in progressively alongside a highlight card", async () => {
    global.fetch = mockFetch({
      discoveryResults: discoveryResponse(["Ramen Ya"]),
    }) as unknown as typeof fetch;

    render(<DiscoveryPage />);

    await waitFor(() => expect(eventSourcesFor("/api/neighborhoods/7/research")).toHaveLength(1));

    // Still researching, nothing resolved yet: highlight + skeleton bank.
    await waitFor(() => expect(screen.getByText(/Finding great spots/)).toBeTruthy());
    expect(document.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);

    act(() => {
      latestEventSource().emit("place", { type: "place", neighborhoodId: 7, place: rawPlace("p0", "Ramen Ya") });
    });

    // Real card renders progressively while still researching.
    await waitFor(() => expect(screen.getByText("Ramen Ya")).toBeTruthy());
    expect(document.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);

    act(() => {
      latestEventSource().emit("done", { researchStatus: "complete" });
    });

    await waitFor(() => expect(document.querySelectorAll(".animate-pulse")).toHaveLength(0));
  });

  // Code review finding (2026-08-21, adversarial): clicking "Search again"
  // while the SSE run is still active used to call POST /api/discovery
  // directly, which ran a second, fully live research pass outside
  // orchestrator.startOrJoin concurrently with the SSE-driven run.
  it("disables 'Search again' while the SSE research run is still active", async () => {
    global.fetch = mockFetch({
      discoveryResults: discoveryResponse(["Ramen Ya"]),
    }) as unknown as typeof fetch;

    render(<DiscoveryPage />);

    await waitFor(() => expect(eventSourcesFor("/api/neighborhoods/7/research")).toHaveLength(1));

    act(() => {
      latestEventSource().emit("place", { type: "place", neighborhoodId: 7, place: rawPlace("p0", "Ramen Ya") });
    });

    await waitFor(() => expect(screen.getByText("Ramen Ya")).toBeTruthy());

    const button = await screen.findByText("Search again") as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    act(() => {
      latestEventSource().emit("done", { researchStatus: "complete" });
    });

    await waitFor(() => expect(button.disabled).toBe(false));
  });
});
