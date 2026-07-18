import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Leaflet requires a DOM — jsdom covers this.
// Mock L.divIcon to return an object carrying the className so tests can assert on it.
vi.mock("leaflet", () => {
  const divIcon = vi.fn((opts: { className?: string } = {}) => ({
    className: opts?.className ?? "",
  }));
  const Icon = { Default: { prototype: {}, mergeOptions: vi.fn() } };
  return {
    default: { divIcon, Icon },
    divIcon,
    Icon,
  };
});

vi.mock("react-leaflet", () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="map-container" role="application" aria-label="Discovery map">
      {children}
    </div>
  ),
  TileLayer: () => null,
  Marker: ({
    children,
    eventHandlers,
    position,
    icon,
  }: {
    children?: React.ReactNode;
    eventHandlers?: { click?: () => void };
    position: [number, number];
    icon?: { className?: string };
  }) => (
    <button
      data-testid={`marker-${position[0]}-${position[1]}`}
      data-icon-class={icon?.className ?? ""}
      onClick={eventHandlers?.click}
    >
      {children}
    </button>
  ),
  useMap: () => ({ fitBounds: vi.fn() }),
}));

vi.mock("leaflet/dist/leaflet.css", () => ({}));

import DiscoveryMap from "../DiscoveryMap";

const eatPlace = {
  placeId: "place-1",
  name: "Ramen Shop",
  lat: 35.69,
  lng: 139.69,
  category: "eat" as const,
  worthTheDetour: false,
};

const visitPlace = {
  placeId: "place-2",
  name: "Senso-ji Temple",
  lat: 35.70,
  lng: 139.70,
  category: "visit" as const,
  worthTheDetour: false,
};

const detourPlace = {
  placeId: "place-3",
  name: "Hidden Gem Cafe",
  lat: 35.71,
  lng: 139.71,
  category: "eat" as const,
  worthTheDetour: true,
};

describe("DiscoveryMap", () => {
  beforeAll(() => {
    // jsdom doesn't implement ResizeObserver
    global.ResizeObserver = vi.fn(() => ({
      observe: vi.fn(),
      unobserve: vi.fn(),
      disconnect: vi.fn(),
    }));
  });

  it("mounts without error when places is empty", () => {
    expect(() =>
      render(
        <DiscoveryMap places={[]} selectedPlaceId={null} onPinClick={vi.fn()} />,
      ),
    ).not.toThrow();
  });

  it("calls onPinClick with the correct placeId when a marker is clicked", async () => {
    const onPinClick = vi.fn();
    render(
      <DiscoveryMap
        places={[eatPlace, visitPlace]}
        selectedPlaceId={null}
        onPinClick={onPinClick}
      />,
    );
    const user = userEvent.setup();
    await user.click(
      screen.getByTestId(`marker-${eatPlace.lat}-${eatPlace.lng}`),
    );
    expect(onPinClick).toHaveBeenCalledWith("place-1");
  });

  it("applies pin-selected class to the marker whose placeId matches selectedPlaceId", () => {
    render(
      <DiscoveryMap
        places={[eatPlace, visitPlace]}
        selectedPlaceId="place-1"
        onPinClick={vi.fn()}
      />,
    );
    const selectedMarker = screen.getByTestId(
      `marker-${eatPlace.lat}-${eatPlace.lng}`,
    );
    const unselectedMarker = screen.getByTestId(
      `marker-${visitPlace.lat}-${visitPlace.lng}`,
    );
    expect(selectedMarker.getAttribute("data-icon-class")).toContain(
      "pin-selected",
    );
    expect(unselectedMarker.getAttribute("data-icon-class")).not.toContain(
      "pin-selected",
    );
  });

  it("renders a hotel marker when lodgingLat and lodgingLng are both non-null", () => {
    render(
      <DiscoveryMap
        places={[eatPlace]}
        selectedPlaceId={null}
        onPinClick={vi.fn()}
        lodgingLat={35.5}
        lodgingLng={139.5}
      />,
    );
    expect(screen.getByTestId("marker-35.5-139.5")).toBeDefined();
  });

  it("does not render a hotel marker when lodgingLat and lodgingLng are not provided", () => {
    render(
      <DiscoveryMap
        places={[eatPlace]}
        selectedPlaceId={null}
        onPinClick={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("marker-35.5-139.5")).toBeNull();
  });

  it("gives eat markers the pin-eat class (amber)", () => {
    render(
      <DiscoveryMap
        places={[eatPlace]}
        selectedPlaceId={null}
        onPinClick={vi.fn()}
      />,
    );
    const marker = screen.getByTestId(
      `marker-${eatPlace.lat}-${eatPlace.lng}`,
    );
    expect(marker.getAttribute("data-icon-class")).toContain("pin-eat");
    expect(marker.getAttribute("data-icon-class")).not.toContain("pin-visit");
  });

  it("gives visit markers the pin-visit class (blue)", () => {
    render(
      <DiscoveryMap
        places={[visitPlace]}
        selectedPlaceId={null}
        onPinClick={vi.fn()}
      />,
    );
    const marker = screen.getByTestId(
      `marker-${visitPlace.lat}-${visitPlace.lng}`,
    );
    expect(marker.getAttribute("data-icon-class")).toContain("pin-visit");
    expect(marker.getAttribute("data-icon-class")).not.toContain("pin-eat");
  });

  it("gives worthTheDetour markers the pin-worth-the-detour ring class", () => {
    render(
      <DiscoveryMap
        places={[detourPlace]}
        selectedPlaceId={null}
        onPinClick={vi.fn()}
      />,
    );
    const marker = screen.getByTestId(
      `marker-${detourPlace.lat}-${detourPlace.lng}`,
    );
    expect(marker.getAttribute("data-icon-class")).toContain(
      "pin-worth-the-detour",
    );
  });

  it("does not apply pin-worth-the-detour class when worthTheDetour is false", () => {
    render(
      <DiscoveryMap
        places={[eatPlace]}
        selectedPlaceId={null}
        onPinClick={vi.fn()}
      />,
    );
    const marker = screen.getByTestId(
      `marker-${eatPlace.lat}-${eatPlace.lng}`,
    );
    expect(marker.getAttribute("data-icon-class")).not.toContain(
      "pin-worth-the-detour",
    );
  });
});
