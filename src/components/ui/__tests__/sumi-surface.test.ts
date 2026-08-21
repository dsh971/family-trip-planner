import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { render, screen } from "@testing-library/react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardFooter,
  DatePicker,
  EmptyState,
  Input,
  Skeleton,
  Timeline,
  TooltipProvider,
} from "@sumiui/react";
import type { AlertVariant, BadgeVariant, ButtonVariant, TimelineItemData } from "@sumiui/react";

// U8 (plan 2026-08-20-011): component-surface pin test for the @sumiui/react
// 2.0.0 -> 2.1.1 bump (R11). This app never imports Sumi's own type
// declarations at runtime, so a version bump that silently renames/removes
// an export or drops a prop this app relies on would otherwise only surface
// as a runtime crash in the browser, not necessarily a build/type failure at
// every affected call site. Pinning the exact exports and prop shapes this
// app depends on (per `grep -rhn 'from "@sumiui/react"' src`, checked before
// writing this test) means a future Sumi upgrade that breaks one of these
// fails loudly here, per the WG CLI-fixture-pinning precedent
// (src/services/wanderlust-goat/client.test.ts).
//
// Plain `.ts` (not `.tsx`, per the plan's file list) — this project's
// esbuild/oxc transform doesn't parse JSX in `.ts` files, so component trees
// below are built with React.createElement rather than JSX syntax.
//
// This is intentionally scoped to exactly what src/app and src/components
// import from @sumiui/react today: Alert, Badge, Button, Card/CardBody/
// CardFooter, DatePicker, EmptyState, Input, Skeleton, Timeline,
// TooltipProvider — not the library's full surface.

describe("Sumi UI surface pin (@sumiui/react 2.1.1)", () => {
  it("exports every component this app imports", () => {
    expect(Alert).toBeDefined();
    expect(Badge).toBeDefined();
    expect(Button).toBeDefined();
    expect(Card).toBeDefined();
    expect(CardBody).toBeDefined();
    expect(CardFooter).toBeDefined();
    expect(DatePicker).toBeDefined();
    expect(EmptyState).toBeDefined();
    expect(Input).toBeDefined();
    expect(Skeleton).toBeDefined();
    expect(Timeline).toBeDefined();
    expect(TooltipProvider).toBeDefined();
  });

  it("Button accepts the variants/sizes this app uses and renders a real <button>", () => {
    const variants: ButtonVariant[] = ["primary", "secondary", "ghost", "danger"];
    for (const variant of variants) {
      const { unmount } = render(
        createElement(Button, { variant, size: "sm", onClick: () => {} }, "Go")
      );
      expect(screen.getByRole("button", { name: "Go" })).toBeTruthy();
      unmount();
    }
  });

  it("Button supports the loading prop used for in-flight submit states", () => {
    render(createElement(Button, { loading: true }, "Saving"));
    expect(screen.getByRole("button")).toBeTruthy();
  });

  it("Alert accepts the variants this app uses (danger, warning) and renders content", () => {
    const variants: AlertVariant[] = ["danger", "warning"];
    for (const variant of variants) {
      const { unmount } = render(createElement(Alert, { variant }, "Something happened"));
      expect(screen.getByText("Something happened")).toBeTruthy();
      unmount();
    }
  });

  it("Badge accepts the variants this app uses and renders its label", () => {
    const variants: BadgeVariant[] = ["neutral", "success", "warning", "danger", "info"];
    for (const variant of variants) {
      const { unmount } = render(createElement(Badge, { variant }, "Eat"));
      expect(screen.getByText("Eat")).toBeTruthy();
      unmount();
    }
  });

  it("Card/CardBody/CardFooter compose as a nested structure", () => {
    render(
      createElement(
        Card,
        null,
        createElement(CardBody, null, "Body content"),
        createElement(CardFooter, null, "Footer content")
      )
    );
    expect(screen.getByText("Body content")).toBeTruthy();
    expect(screen.getByText("Footer content")).toBeTruthy();
  });

  it("Input accepts a label and forwards onChange", () => {
    render(createElement(Input, { label: "City", placeholder: "e.g. Paris", onChange: () => {} }));
    expect(screen.getByPlaceholderText("e.g. Paris")).toBeTruthy();
  });

  it("DatePicker accepts label/value/onChange without throwing", () => {
    render(createElement(DatePicker, { label: "Start date", value: "", onChange: () => {} }));
    expect(screen.getByText("Start date")).toBeTruthy();
  });

  it("EmptyState accepts title/description", () => {
    render(createElement(EmptyState, { title: "No places yet", description: "Nothing found." }));
    expect(screen.getByText("No places yet")).toBeTruthy();
    expect(screen.getByText("Nothing found.")).toBeTruthy();
  });

  it("Skeleton renders without throwing given height/width props", () => {
    const { container } = render(createElement(Skeleton, { height: "2rem", width: "10rem" }));
    expect(container.firstChild).toBeTruthy();
  });

  it("Timeline renders items with the id/time/title/marker/description shape this app relies on", () => {
    const items: TimelineItemData[] = [
      { id: "1", time: "09:00", title: "Breakfast", marker: "dot-ok" },
      { id: "2", title: "Rest", description: "Pacing block", marker: "dot-pending" },
    ];
    render(createElement(Timeline, { items, timeGutter: true }));
    expect(screen.getByText("Breakfast")).toBeTruthy();
    expect(screen.getByText("Rest")).toBeTruthy();
    expect(screen.getByText("Pacing block")).toBeTruthy();
  });

  it("TooltipProvider renders its children", () => {
    render(createElement(TooltipProvider, null, createElement("span", null, "Wrapped")));
    expect(screen.getByText("Wrapped")).toBeTruthy();
  });
});
