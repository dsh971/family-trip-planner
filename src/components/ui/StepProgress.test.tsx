import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import StepProgress from "./StepProgress";

describe("StepProgress", () => {
  it("profile step: Profile is active, rest upcoming", () => {
    render(<StepProgress currentStep="profile" />);
    expect(screen.getByText(/● Profile/)).toBeTruthy();
    expect(screen.getByText(/○ Area/)).toBeTruthy();
    expect(screen.getByText(/○ Discover/)).toBeTruthy();
    expect(screen.getByText(/○ Plan/)).toBeTruthy();
    expect(screen.queryByText(/✓/)).toBeNull();
  });

  it("area step: Profile done, Area active, rest upcoming", () => {
    render(<StepProgress currentStep="area" />);
    expect(screen.getByText(/✓ Profile/)).toBeTruthy();
    expect(screen.getByText(/● Area/)).toBeTruthy();
    expect(screen.getByText(/○ Discover/)).toBeTruthy();
    expect(screen.getByText(/○ Plan/)).toBeTruthy();
  });

  it("discover step: Profile+Area done, Discover active, Plan upcoming", () => {
    render(<StepProgress currentStep="discover" />);
    expect(screen.getByText(/✓ Profile/)).toBeTruthy();
    expect(screen.getByText(/✓ Area/)).toBeTruthy();
    expect(screen.getByText(/● Discover/)).toBeTruthy();
    expect(screen.getByText(/○ Plan/)).toBeTruthy();
  });

  it("plan step: Profile+Area+Discover done, Plan active", () => {
    render(<StepProgress currentStep="plan" />);
    expect(screen.getByText(/✓ Profile/)).toBeTruthy();
    expect(screen.getByText(/✓ Area/)).toBeTruthy();
    expect(screen.getByText(/✓ Discover/)).toBeTruthy();
    expect(screen.getByText(/● Plan/)).toBeTruthy();
  });

  it("renders all four step labels", () => {
    render(<StepProgress currentStep="area" />);
    expect(screen.getByText(/Profile/)).toBeTruthy();
    expect(screen.getByText(/Area/)).toBeTruthy();
    expect(screen.getByText(/Discover/)).toBeTruthy();
    expect(screen.getByText(/Plan/)).toBeTruthy();
  });

  it("renders arrow separators between steps", () => {
    render(<StepProgress currentStep="discover" />);
    const arrows = screen.getAllByText("→");
    expect(arrows).toHaveLength(3);
  });
});
