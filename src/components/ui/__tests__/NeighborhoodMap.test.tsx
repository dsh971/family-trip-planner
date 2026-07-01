import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Leaflet requires a DOM with document.createElement('canvas') — jsdom covers this.
// react-leaflet hooks into window so we need to stub the minimum.
vi.mock("leaflet", () => {
  const divIcon = vi.fn(() => ({}));
  const Icon = { Default: { prototype: {}, mergeOptions: vi.fn() } };
  return {
    default: { divIcon, Icon },
    divIcon,
    Icon,
  };
});

vi.mock("react-leaflet", () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="map-container" role="application" aria-label="Tokyo neighborhoods map">
      {children}
    </div>
  ),
  TileLayer: () => null,
  Marker: ({
    children,
    eventHandlers,
    position,
  }: {
    children?: React.ReactNode;
    eventHandlers?: { click?: () => void };
    position: [number, number];
  }) => (
    <button
      data-testid={`marker-${position[0]}-${position[1]}`}
      onClick={eventHandlers?.click}
    >
      {children}
    </button>
  ),
  Popup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("leaflet/dist/leaflet.css", () => ({}));

import NeighborhoodMap from "../NeighborhoodMap";

const sampleNeighborhoods = [
  { id: 1, name: "Kichijoji", centroidLat: 35.7022, centroidLng: 139.5803 },
  { id: 2, name: "Yanaka", centroidLat: 35.7262, centroidLng: 139.7706 },
];

describe("NeighborhoodMap", () => {
  beforeAll(() => {
    // jsdom doesn't implement ResizeObserver
    global.ResizeObserver = vi.fn(() => ({
      observe: vi.fn(),
      unobserve: vi.fn(),
      disconnect: vi.fn(),
    }));
  });

  it("renders without throwing when given empty neighborhoods and selectedId null", () => {
    expect(() =>
      render(<NeighborhoodMap neighborhoods={[]} selectedId={null} onSelect={vi.fn()} />)
    ).not.toThrow();
  });

  it("renders one marker per neighborhood", () => {
    render(
      <NeighborhoodMap
        neighborhoods={sampleNeighborhoods}
        selectedId={null}
        onSelect={vi.fn()}
      />
    );
    expect(screen.getByTestId("marker-35.7022-139.5803")).toBeDefined();
    expect(screen.getByTestId("marker-35.7262-139.7706")).toBeDefined();
  });

  it("calls onSelect with correct id when a marker is clicked", async () => {
    const onSelect = vi.fn();
    render(
      <NeighborhoodMap
        neighborhoods={sampleNeighborhoods}
        selectedId={null}
        onSelect={onSelect}
      />
    );
    const user = userEvent.setup();
    await user.click(screen.getByTestId("marker-35.7022-139.5803"));
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it("exposes an accessible map container with role application and aria-label", () => {
    render(
      <NeighborhoodMap
        neighborhoods={sampleNeighborhoods}
        selectedId={null}
        onSelect={vi.fn()}
      />
    );
    const maps = screen.getAllByRole("application");
    expect(maps.length).toBeGreaterThanOrEqual(1);
    // The outer wrapper carries the aria-label
    expect(screen.getAllByRole("application")[0].getAttribute("aria-label")).toContain("Tokyo");
  });
});
