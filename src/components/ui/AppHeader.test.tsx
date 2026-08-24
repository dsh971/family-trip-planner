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
    expect(screen.getByText("Trip Planner")).toBeTruthy();
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
});
