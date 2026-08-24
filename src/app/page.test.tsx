import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Home from "./page";

// Design-fidelity fix (2026-08-22): Home was rewritten to match
// Hybrid-Home.dc.html — real hasTrip/noTrip branching (previously a single
// static state), a destination search feeding into /profile, and
// bottom-anchored content. Covers both states plus the search-then-continue
// handoff.

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

// getActiveTripId/setActiveTripId/clearActiveTripId wrap window.localStorage
// in try/catch (src/lib/activeTrip.ts) — jsdom's localStorage in this
// vitest environment throws on write ("setItem is not a function"), so the
// real implementation always resolves to "no active trip" here regardless
// of what's actually stored. Mocking the module is the only way to
// exercise the hasTrip branch.
const getActiveTripIdMock = vi.fn<() => string | null>();
vi.mock("@/lib/activeTrip", () => ({
  getActiveTripId: () => getActiveTripIdMock(),
  clearActiveTripId: vi.fn(),
}));

function mockFetch(handlers: {
  trip?: { id: number; status: string; destinationName: string; startDate: string };
  tripOk?: boolean;
  destinationsQuery?: Array<{ id: number; name: string; country: string; slug: string }>;
}) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.startsWith("/api/trips/")) {
      if (handlers.tripOk === false) {
        return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
      }
      return new Response(JSON.stringify(handlers.trip), { status: 200 });
    }
    if (url.startsWith("/api/destinations?q=")) {
      return new Response(JSON.stringify(handlers.destinationsQuery ?? []), { status: 200 });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
}

beforeEach(() => {
  pushMock.mockClear();
  getActiveTripIdMock.mockReset();
});

describe("Home", () => {
  it("noTrip: renders the search-driven new-visitor state when there is no active trip", async () => {
    getActiveTripIdMock.mockReturnValue(null);
    global.fetch = mockFetch({}) as unknown as typeof fetch;

    render(<Home />);

    await waitFor(() => expect(screen.getByText("Where to?")).toBeTruthy());
    expect(screen.getByText("Start a new trip")).toBeTruthy();
    expect(screen.getByPlaceholderText(/Try "Marrakech"/)).toBeTruthy();
  });

  it("hasTrip: renders the returning-traveler state with the trip's destination name", async () => {
    getActiveTripIdMock.mockReturnValue("42");
    global.fetch = mockFetch({
      trip: { id: 42, status: "NeighborhoodSelection", destinationName: "Lisbon", startDate: "2026-09-01" },
    }) as unknown as typeof fetch;

    render(<Home />);

    await waitFor(() => expect(screen.getByText("Lisbon")).toBeTruthy());
    expect(screen.getByText("Continue planning")).toBeTruthy();
    expect(screen.queryByText("Where to?")).toBeNull();
  });

  it("hasTrip: 'Continue planning' routes based on the trip's current status", async () => {
    const user = userEvent.setup();
    getActiveTripIdMock.mockReturnValue("42");
    global.fetch = mockFetch({
      trip: { id: 42, status: "Discovery", destinationName: "Lisbon", startDate: "2026-09-01" },
    }) as unknown as typeof fetch;

    render(<Home />);
    await waitFor(() => expect(screen.getByText("Lisbon")).toBeTruthy());

    await user.click(screen.getByText("Continue planning"));
    expect(pushMock).toHaveBeenCalledWith("/trip/42/discovery");
  });

  it("falls back to the noTrip state when the stored trip id no longer resolves", async () => {
    getActiveTripIdMock.mockReturnValue("999");
    global.fetch = mockFetch({ tripOk: false }) as unknown as typeof fetch;

    render(<Home />);

    await waitFor(() => expect(screen.getByText("Where to?")).toBeTruthy());
  });

  it("noTrip: typing and picking a suggestion, then starting a trip, hands the destination off to /profile", async () => {
    const user = userEvent.setup();
    getActiveTripIdMock.mockReturnValue(null);
    global.fetch = mockFetch({
      destinationsQuery: [{ id: 7, name: "Osaka", country: "Japan", slug: "osaka" }],
    }) as unknown as typeof fetch;

    render(<Home />);
    await waitFor(() => expect(screen.getByText("Where to?")).toBeTruthy());

    const input = screen.getByPlaceholderText(/Try "Marrakech"/);
    await user.type(input, "Osa");

    await waitFor(() => expect(screen.getByRole("option", { name: /Osaka/ })).toBeTruthy());
    await user.click(screen.getByRole("option", { name: /Osaka/ }));

    await user.click(screen.getByText("Start a new trip"));

    expect(pushMock).toHaveBeenCalledTimes(1);
    const pushedUrl = pushMock.mock.calls[0]![0] as string;
    expect(pushedUrl).toContain("/profile?");
    expect(pushedUrl).toContain("destinationId=7");
    expect(pushedUrl).toContain("destinationName=Osaka");
  });

  it("noTrip: starting a trip with free-text (no suggestion picked) still hands off the typed name", async () => {
    const user = userEvent.setup();
    getActiveTripIdMock.mockReturnValue(null);
    global.fetch = mockFetch({ destinationsQuery: [] }) as unknown as typeof fetch;

    render(<Home />);
    await waitFor(() => expect(screen.getByText("Where to?")).toBeTruthy());

    const input = screen.getByPlaceholderText(/Try "Marrakech"/);
    await user.type(input, "Nowheresville");

    await user.click(screen.getByText("Start a new trip"));

    const pushedUrl = pushMock.mock.calls[0]![0] as string;
    expect(pushedUrl).toBe("/profile?destinationName=Nowheresville");
  });
});
