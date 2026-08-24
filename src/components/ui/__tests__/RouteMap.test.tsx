import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";

// Same mocking approach as DiscoveryMap.test.tsx / NeighborhoodMap.test.tsx —
// jsdom doesn't implement the DOM APIs react-leaflet/leaflet expect, so the
// map library and react-leaflet's components are stubbed at module level.
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
    <div data-testid="map-container" role="application" aria-label="Route map">
      {children}
    </div>
  ),
  TileLayer: () => null,
  Marker: ({ position }: { position: [number, number] }) => (
    <div data-testid={`marker-${position[0]}-${position[1]}`} />
  ),
  Polyline: ({ positions }: { positions: [number, number][] }) => (
    <div data-testid="polyline" data-points={positions.length} />
  ),
  useMap: () => ({ fitBounds: vi.fn(), setView: vi.fn() }),
}));

vi.mock("leaflet/dist/leaflet.css", () => ({}));

import RouteMap from "../RouteMap";

describe("RouteMap", () => {
  beforeAll(() => {
    global.ResizeObserver = vi.fn(() => ({
      observe: vi.fn(),
      unobserve: vi.fn(),
      disconnect: vi.fn(),
    })) as unknown as typeof ResizeObserver;
  });

  it("renders without throwing when given zero stops", () => {
    expect(() => render(<RouteMap stops={[]} />)).not.toThrow();
    expect(screen.queryByTestId("polyline")).toBeNull();
  });

  it("renders a single numbered pin and no connecting line for one stop", () => {
    render(
      <RouteMap
        stops={[{ id: "1", name: "Belém Tower", lat: 38.6916, lng: -9.2159 }]}
      />
    );
    expect(screen.getByTestId("marker-38.6916--9.2159")).toBeDefined();
    // A route line needs at least two points — must not render with one.
    expect(screen.queryByTestId("polyline")).toBeNull();
  });

  it("renders a numbered pin per stop and a connecting line for two or more stops", () => {
    render(
      <RouteMap
        stops={[
          { id: "1", name: "Belém Tower", lat: 38.6916, lng: -9.2159 },
          { id: "2", name: "Jerónimos Monastery", lat: 38.6979, lng: -9.2065 },
          { id: "3", name: "LX Factory", lat: 38.7043, lng: -9.1785 },
        ]}
      />
    );
    expect(screen.getByTestId("marker-38.6916--9.2159")).toBeDefined();
    expect(screen.getByTestId("marker-38.6979--9.2065")).toBeDefined();
    expect(screen.getByTestId("marker-38.7043--9.1785")).toBeDefined();
    const line = screen.getByTestId("polyline");
    expect(line.getAttribute("data-points")).toBe("3");
  });
});
