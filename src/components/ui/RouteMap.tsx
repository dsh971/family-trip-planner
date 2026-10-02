"use client";

import "leaflet/dist/leaflet.css";
import { useEffect } from "react";
import { MapContainer, TileLayer, Marker, Polyline, useMap } from "react-leaflet";
import L from "leaflet";

export interface RouteMapStop {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

export interface RouteMapProps {
  stops: RouteMapStop[];
}

function makeNumberedIcon(index: number) {
  return L.divIcon({
    className: "",
    html: `<div style="
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: var(--accent, #2d9b6f);
      border: 2px solid white;
      box-shadow: 0 2px 6px rgba(0,0,0,0.35);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: 700;
      color: white;
    ">${index}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -18],
  });
}

function BoundsFitter({ positions }: { positions: [number, number][] }) {
  const map = useMap();
  const posStr = JSON.stringify(positions);
  useEffect(() => {
    // Same zero-size-container defect as NeighborhoodMap.tsx's BoundsFitter
    // (docs/plans/2026-09-12-001-fix-design-audit-bugs-plan.md U3): this map
    // mounts inside `.itinerary-desktop-split { display: none }` below
    // 1024px, so without this size-ready gate a fitBounds/setView committed
    // at mount would frame the map for a (0, 0) viewport.
    const container = map.getContainer();
    let fitted = false;
    const observer = new ResizeObserver(() => tryFit());

    function tryFit() {
      if (fitted) return;
      if (container.clientWidth === 0 || container.clientHeight === 0) return;
      fitted = true;
      observer.disconnect();
      map.invalidateSize();
      if (positions.length > 1) {
        map.fitBounds(positions as L.LatLngBoundsExpression, { padding: [30, 30] });
      } else if (positions.length === 1) {
        map.setView(positions[0], 15);
      }
    }

    observer.observe(container);
    tryFit();

    return () => observer.disconnect();
    // posStr is the stable serialized form of positions — intentional dep
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, posStr]);
  return null;
}

// Numbered-pin route map for a single itinerary day (U7, plan
// 2026-08-23-002-feat-hybrid-design-fidelity-gaps). Distinct from
// DiscoveryMap (category-colored pins, click-to-select) and NeighborhoodMap
// (numbered teardrop pins, no connecting line) because neither draws a
// route between stops — this one adds a dashed Polyline in stop order,
// matching Web-Itinerary.dc.html. Pin numbering reuses NeighborhoodMap's
// "numbered circle" approach rather than its teardrop shape, since a plain
// circle reads better at the smaller 28px size used here.
export default function RouteMap({ stops }: RouteMapProps) {
  useEffect(() => {
    delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)
      ._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconRetinaUrl:
        "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
      iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
      shadowUrl:
        "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
    });
  }, []);

  const positions: [number, number][] = stops.map((s) => [s.lat, s.lng]);

  return (
    <div
      className="w-full h-full rounded-xl overflow-hidden"
      role="application"
      aria-label="Route map"
    >
      <MapContainer
        center={[35.6762, 139.6503]}
        zoom={12}
        // zoomSnap=0: same fitBounds-flooring fix applied in DiscoveryMap.tsx
        // and NeighborhoodMap.tsx — Leaflet's default zoomSnap (1) floors the
        // computed fit zoom to the nearest whole level, loosening the frame
        // more than the stop cluster warrants.
        zoomSnap={0}
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <BoundsFitter positions={positions} />

        {positions.length >= 2 && (
          <Polyline
            positions={positions}
            pathOptions={{
              color: "#2d9b6f",
              weight: 3,
              opacity: 0.8,
              dashArray: "6 8",
            }}
          />
        )}

        {stops.map((stop, index) => (
          <Marker
            key={stop.id}
            position={[stop.lat, stop.lng]}
            icon={makeNumberedIcon(index + 1)}
          />
        ))}
      </MapContainer>
    </div>
  );
}
