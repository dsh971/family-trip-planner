"use client";

import "leaflet/dist/leaflet.css";
import { useEffect } from "react";
import { MapContainer, TileLayer, Marker } from "react-leaflet";
import L from "leaflet";

export interface DestinationPreviewMapProps {
  lat: number;
  lng: number;
}

function makePinIcon() {
  return L.divIcon({
    className: "",
    html: `<div style="filter:drop-shadow(0 3px 5px rgba(0,0,0,0.35));">
      <svg width="30" height="38" viewBox="0 0 32 40">
        <path d="M16 0C7 0 0 7 0 16c0 11 16 24 16 24s16-13 16-24C32 7 25 0 16 0z" fill="var(--accent, #2d9b6f)"></path>
        <circle cx="16" cy="16" r="6" fill="white"></circle>
      </svg>
    </div>`,
    iconSize: [30, 38],
    iconAnchor: [15, 38],
    popupAnchor: [0, -38],
  });
}

// Single-pin "here's roughly where this destination is" preview for the
// Trip setup panel (TripSetupArt) — deliberately not a full DiscoveryMap/
// NeighborhoodMap-style interactive map (no click handling, no bounds
// fitting across multiple points): this is one city-level pin, framed at a
// fixed city-scale zoom, not a cluster of points that need fitBounds.
export default function DestinationPreviewMap({ lat, lng }: DestinationPreviewMapProps) {
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

  return (
    <div
      className="w-full h-full"
      role="application"
      aria-label="Destination preview map"
    >
      <MapContainer
        center={[lat, lng]}
        zoom={11}
        zoomSnap={0}
        zoomControl={false}
        dragging={false}
        scrollWheelZoom={false}
        doubleClickZoom={false}
        touchZoom={false}
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Marker position={[lat, lng]} icon={makePinIcon()} />
      </MapContainer>
    </div>
  );
}
