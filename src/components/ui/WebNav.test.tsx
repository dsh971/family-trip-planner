import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { WebNav, type WebNavProps } from "./WebNav";
import { ThemeProvider } from "@/components/providers/ThemeProvider";

// U2, plan 2026-08-23-002-feat-hybrid-design-fidelity-gaps: desktop
// (>=1024px) persistent top nav replacing AppHeader/BottomNav. jsdom does
// not evaluate CSS media queries (no precedent for that anywhere in this
// codebase — AppHeader.test.tsx, the closest analog, never asserted on its
// fixed positioning either), so the actual show/hide-by-breakpoint behavior
// is verified via real-browser Playwright screenshots per the plan, not
// here. What IS verified here: the component renders the right content and
// carries the `web-nav` class the breakpoint rule in globals.css targets.

let mockPathname = "/trip/10/neighborhoods";
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));

function renderNav(props: Partial<WebNavProps> = {}) {
  return render(
    <ThemeProvider>
      <WebNav tripId="10" {...props} />
    </ThemeProvider>
  );
}

describe("WebNav", () => {
  it("renders all five tabs (Home plus the four route tabs)", () => {
    mockPathname = "/trip/10/neighborhoods";
    renderNav();
    expect(screen.getByText("Home")).toBeTruthy();
    expect(screen.getByText("Profile")).toBeTruthy();
    expect(screen.getByText("Area")).toBeTruthy();
    expect(screen.getByText("Discover")).toBeTruthy();
    expect(screen.getByText("Plan")).toBeTruthy();
  });

  it("highlights Home only on an exact '/' match, not as a substring of every path", () => {
    // Home's match ("/") would be a substring of every pathname under
    // .includes() — this is what `exact` on the tab def guards against.
    mockPathname = "/trip/10/neighborhoods";
    renderNav();
    expect(screen.getByText("Home").getAttribute("style")).not.toContain("var(--accent)");

    mockPathname = "/";
    renderNav();
    expect(screen.getAllByText("Home")[1]!.getAttribute("style")).toContain("var(--accent)");
  });

  it("highlights the tab matching the current pathname", () => {
    mockPathname = "/trip/10/neighborhoods";
    renderNav();
    expect(screen.getByText("Area").getAttribute("style")).toContain("var(--accent)");
    expect(screen.getByText("Profile").getAttribute("style")).not.toContain("var(--accent)");
  });

  it("highlights Discover for both /discovery and /decisions routes", () => {
    mockPathname = "/trip/10/decisions";
    renderNav();
    expect(screen.getByText("Discover").getAttribute("style")).toContain("var(--accent)");

    mockPathname = "/trip/10/discovery";
    renderNav();
    expect(screen.getAllByText("Discover")[1]!.getAttribute("style")).toContain("var(--accent)");
  });

  it("shows a trip-context chip (destination + dates) when trip data is provided", () => {
    mockPathname = "/trip/10/discovery";
    renderNav({ tripName: "Lisbon", tripDates: "Mar 12 – Mar 19" });
    expect(screen.getByTestId("trip-context-chip")).toBeTruthy();
    expect(screen.getByText("Lisbon")).toBeTruthy();
    expect(screen.getByText(/Mar 12/)).toBeTruthy();
  });

  it("renders without a trip-context chip when no trip data is provided (e.g. on /profile)", () => {
    mockPathname = "/profile";
    renderNav({ tripId: undefined, tripName: undefined, tripDates: undefined });
    expect(screen.queryByTestId("trip-context-chip")).toBeNull();
    // Profile still links (pre-trip route exists); the rest render as
    // non-interactive text since there's no tripId to build their hrefs.
    expect(screen.getByText("Profile").closest("a")).toBeTruthy();
    expect(screen.getByText("Area").closest("a")).toBeNull();
  });

  it("carries the `web-nav` breakpoint class the globals.css show/hide rule targets", () => {
    mockPathname = "/trip/10/itinerary";
    const { container } = renderNav();
    const header = container.querySelector("header");
    expect(header?.className).toContain("web-nav");
  });
});
