import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppHeader } from "./AppHeader";
import { ThemeProvider } from "@/components/providers/ThemeProvider";

// Design-fidelity fix (2026-08-22): the global AppHeader used to render on
// every route, including Home — but Home's Hybrid mockup is a deliberate
// full-bleed dark hero with "minimal competing chrome," and the light-
// surface header sitting on top of it contradicted that. AppHeader now
// hides itself on "/" only.

let mockPathname = "/";
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));

describe("AppHeader", () => {
  it("renders on a non-Home route", () => {
    mockPathname = "/trip/1/neighborhoods";
    render(
      <ThemeProvider>
        <AppHeader />
      </ThemeProvider>
    );
    expect(screen.getByText("Viridian")).toBeTruthy();
  });

  it("renders nothing on Home ('/')", () => {
    mockPathname = "/";
    const { container } = render(
      <ThemeProvider>
        <AppHeader />
      </ThemeProvider>
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a back link to the previous stage in the flow", () => {
    mockPathname = "/trip/1/discovery";
    render(
      <ThemeProvider>
        <AppHeader />
      </ThemeProvider>
    );
    expect(screen.getByLabelText("Back").getAttribute("href")).toBe("/trip/1/neighborhoods");
  });

  it("points the back link at Home from the pre-trip /profile route", () => {
    mockPathname = "/profile";
    render(
      <ThemeProvider>
        <AppHeader />
      </ThemeProvider>
    );
    expect(screen.getByLabelText("Back").getAttribute("href")).toBe("/");
  });

  it("chains back links through the full flow order", () => {
    const expected: [string, string][] = [
      ["/trip/1/profile", "/"],
      ["/trip/1/neighborhoods", "/trip/1/profile"],
      ["/trip/1/discovery", "/trip/1/neighborhoods"],
      ["/trip/1/decisions", "/trip/1/discovery"],
      ["/trip/1/itinerary", "/trip/1/decisions"],
    ];
    for (const [path, expectedHref] of expected) {
      mockPathname = path;
      const { unmount } = render(
        <ThemeProvider>
          <AppHeader />
        </ThemeProvider>
      );
      expect(screen.getByLabelText("Back").getAttribute("href")).toBe(expectedHref);
      unmount();
    }
  });
});
