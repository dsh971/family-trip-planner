import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ProfilePage from "./page";

// U3 (plan 2026-08-20-011): Profile's destination field now does
// search-as-you-type against GET /api/destinations?q= instead of always
// creating a new destination on submit. These tests cover the two
// behaviors the plan calls out explicitly: a matching name surfaces as a
// selectable suggestion, and selecting it submits the trip with that
// destination's real id rather than free-text name/country.

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => "/profile",
}));

function mockFetchSequence(handlers: {
  destinationsQuery?: Array<{ id: number; name: string; country: string; slug: string }>;
  onTripsRequest?: (body: Record<string, unknown>) => void;
}) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();

    if (url.startsWith("/api/destinations?q=")) {
      return new Response(JSON.stringify(handlers.destinationsQuery ?? []), { status: 200 });
    }
    if (url === "/api/profile") {
      return new Response(JSON.stringify({ id: 7 }), { status: 201 });
    }
    if (url === "/api/trips") {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      handlers.onTripsRequest?.(body);
      return new Response(JSON.stringify({ id: 99 }), { status: 201 });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
}

describe("Profile page — destination search-as-you-type (U3)", () => {
  beforeEach(() => {
    pushMock.mockClear();
  });

  it("shows a matching existing destination as a selectable suggestion while typing", async () => {
    const user = userEvent.setup();
    global.fetch = mockFetchSequence({
      destinationsQuery: [{ id: 42, name: "Kyoto", country: "Japan", slug: "kyoto" }],
    }) as unknown as typeof fetch;

    render(<ProfilePage />);
    const cityInput = screen.getByPlaceholderText("e.g. Paris");
    await user.type(cityInput, "Kyo");

    await waitFor(
      () => {
        expect(screen.getByRole("option", { name: /Kyoto/ })).toBeTruthy();
      },
      { timeout: 1000 }
    );
  });

  it("does not show a dropdown when nothing matches", async () => {
    const user = userEvent.setup();
    global.fetch = mockFetchSequence({ destinationsQuery: [] }) as unknown as typeof fetch;

    render(<ProfilePage />);
    const cityInput = screen.getByPlaceholderText("e.g. Paris");
    await user.type(cityInput, "Nonexistentville");

    // Give the debounced fetch time to resolve, then confirm no dropdown appeared.
    await new Promise((r) => setTimeout(r, 400));
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("selecting a suggestion and submitting creates a trip against that destination's id, not a new one", async () => {
    const user = userEvent.setup();
    let tripRequestBody: Record<string, unknown> | undefined;
    global.fetch = mockFetchSequence({
      destinationsQuery: [{ id: 42, name: "Kyoto", country: "Japan", slug: "kyoto" }],
      onTripsRequest: (body) => {
        tripRequestBody = body;
      },
    }) as unknown as typeof fetch;

    const { container } = render(<ProfilePage />);
    const cityInput = screen.getByPlaceholderText("e.g. Paris");
    await user.type(cityInput, "Kyo");

    const option = await waitFor(() => screen.getByRole("option", { name: /Kyoto/ }), {
      timeout: 1000,
    });
    await user.click(option);

    // Directly fire submit on the form (bypassing the CTA button's
    // requestSubmit indirection, which jsdom doesn't reliably support).
    const form = container.querySelector("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/trip/99/neighborhoods");
    });

    expect(tripRequestBody).toBeDefined();
    expect(tripRequestBody!.destinationId).toBe(42);
    expect(tripRequestBody!.destinationName).toBeUndefined();
  });

  it("submitting a novel destination name (no suggestion selected) still creates a new destination by name", async () => {
    const user = userEvent.setup();
    let tripRequestBody: Record<string, unknown> | undefined;
    global.fetch = mockFetchSequence({
      destinationsQuery: [],
      onTripsRequest: (body) => {
        tripRequestBody = body;
      },
    }) as unknown as typeof fetch;

    const { container } = render(<ProfilePage />);
    const cityInput = screen.getByPlaceholderText("e.g. Paris");
    await user.type(cityInput, "Lisbon");

    const form = container.querySelector("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/trip/99/neighborhoods");
    });

    expect(tripRequestBody).toBeDefined();
    expect(tripRequestBody!.destinationName).toBe("Lisbon");
    expect(tripRequestBody!.destinationId).toBeUndefined();
  });
});
