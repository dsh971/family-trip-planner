import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ItineraryPage from "./page";

// U7 (plan 2026-08-23-002-feat-hybrid-design-fidelity-gaps): covers the
// desktop split-pane's day-filtering behavior. Both the mobile continuous-
// list and the desktop single-day+map variants render simultaneously in
// the DOM (CSS, not JS, decides which is visible per breakpoint — jsdom
// doesn't evaluate media queries), so what's testable here is (a) both
// variants render correct data, and (b) the desktop pills actually filter
// while the mobile pills/list are untouched. Visual breakpoint switching
// itself is verified via real-browser screenshots, not here.

vi.mock("next/navigation", () => ({
  useParams: () => ({ tripId: "10" }),
}));

vi.mock("@/components/ui/RouteMap", () => ({
  default: ({ stops }: { stops: Array<{ id: string; name: string }> }) => (
    <div data-testid="route-map" data-stop-ids={stops.map((s) => s.id).join(",")}>
      {stops.map((s) => (
        <span key={s.id}>{s.name}</span>
      ))}
    </div>
  ),
}));

function placeSegment(id: number, name: string, lat: number, lng: number) {
  return {
    id,
    dayId: 1,
    order: String(id).padStart(2, "0"),
    segmentType: "place" as const,
    placeId: id,
    adjustmentState: "scheduled",
    startTime: "09:00",
    endTime: null,
    payload: { category: "visit", placeName: name, worthTheDetour: false, photoReference: null, lat, lng },
  };
}

const ITINERARY_RESPONSE = {
  tripId: 10,
  neighborhood: "Alfama",
  status: "planned",
  pendingDecisionCount: 0,
  days: [
    {
      date: "2026-09-01",
      dayId: 1,
      segments: [
        placeSegment(1, "Belém Tower", 38.6916, -9.2159),
        placeSegment(2, "Jerónimos Monastery", 38.6979, -9.2065),
      ],
    },
    {
      date: "2026-09-02",
      dayId: 2,
      segments: [placeSegment(3, "LX Factory", 38.7043, -9.1785)],
    },
    {
      date: "2026-09-03",
      dayId: 3,
      segments: [], // edge case: a day with zero segments
    },
  ],
};

function mockFetch() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url === "/api/itinerary?tripId=10") {
      return new Response(JSON.stringify(ITINERARY_RESPONSE), { status: 200 });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ItineraryPage — U7 desktop split-pane", () => {
  it("mobile list shows every day's places (unchanged continuous-scroll behavior)", async () => {
    global.fetch = mockFetch() as unknown as typeof fetch;
    render(<ItineraryPage />);

    await waitFor(() => expect(screen.getByTestId("itinerary-days")).toBeDefined());
    const mobileList = screen.getByTestId("itinerary-days");
    expect(within(mobileList).getByText("Belém Tower")).toBeDefined();
    expect(within(mobileList).getByText("Jerónimos Monastery")).toBeDefined();
    expect(within(mobileList).getByText("LX Factory")).toBeDefined();
  });

  it("desktop split-pane defaults to the first day's places and matching map pins", async () => {
    global.fetch = mockFetch() as unknown as typeof fetch;
    render(<ItineraryPage />);

    await waitFor(() => expect(screen.getByTestId("itinerary-desktop-day")).toBeDefined());
    const desktopDay = screen.getByTestId("itinerary-desktop-day");
    expect(within(desktopDay).getByText("Belém Tower")).toBeDefined();
    expect(within(desktopDay).getByText("Jerónimos Monastery")).toBeDefined();
    expect(within(desktopDay).queryByText("LX Factory")).toBeNull();

    const routeMap = screen.getByTestId("route-map");
    expect(routeMap.getAttribute("data-stop-ids")).toBe("1,2");
  });

  it("selecting a desktop day pill filters the desktop list and map together, without touching the mobile list", async () => {
    global.fetch = mockFetch() as unknown as typeof fetch;
    render(<ItineraryPage />);

    await waitFor(() => expect(screen.getByTestId("itinerary-desktop-split")).toBeDefined());

    const desktopSplit = screen.getByTestId("itinerary-desktop-split");
    const day2Pill = within(desktopSplit).getByRole("button", { name: /Day 2/ });
    const user = userEvent.setup();
    await user.click(day2Pill);

    const desktopDay = screen.getByTestId("itinerary-desktop-day");
    expect(within(desktopDay).getByText("LX Factory")).toBeDefined();
    expect(within(desktopDay).queryByText("Belém Tower")).toBeNull();

    const routeMap = screen.getByTestId("route-map");
    expect(routeMap.getAttribute("data-stop-ids")).toBe("3");

    // Mobile's continuous list is untouched by the desktop pill click.
    const mobileList = screen.getByTestId("itinerary-days");
    expect(within(mobileList).getByText("Belém Tower")).toBeDefined();
    expect(within(mobileList).getByText("LX Factory")).toBeDefined();
  });

  it("a day with zero segments renders an empty desktop list and map without erroring", async () => {
    global.fetch = mockFetch() as unknown as typeof fetch;
    render(<ItineraryPage />);

    await waitFor(() => expect(screen.getByTestId("itinerary-desktop-split")).toBeDefined());

    const desktopSplit = screen.getByTestId("itinerary-desktop-split");
    const day3Pill = within(desktopSplit).getByRole("button", { name: /Day 3/ });
    const user = userEvent.setup();
    await user.click(day3Pill);

    const desktopDay = screen.getByTestId("itinerary-desktop-day");
    expect(within(desktopDay).getByText("No places scheduled for this day.")).toBeDefined();
    const routeMap = screen.getByTestId("route-map");
    expect(routeMap.getAttribute("data-stop-ids")).toBe("");
  });
});
