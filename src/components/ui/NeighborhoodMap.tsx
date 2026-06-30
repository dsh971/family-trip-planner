"use client";

import "leaflet/dist/leaflet.css";
import { useEffect } from "react";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";

interface NeighborhoodPin {
  id: number;
  name: string;
  centroidLat: number;
  centroidLng: number;
}

interface NeighborhoodMapProps {
  neighborhoods: NeighborhoodPin[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}

function makeIcon(selected: boolean) {
  return L.divIcon({
    className: "",
    html: `<div style="
      width: 28px;
      height: 28px;
      border-radius: 50% 50% 50% 0;
      transform: rotate(-45deg);
      background: ${selected ? "var(--accent, #2d9b6f)" : "#555"};
      border: 2px solid white;
      box-shadow: 0 2px 6px rgba(0,0,0,0.35);
    "></div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 28],
    popupAnchor: [0, -30],
  });
}

export default function NeighborhoodMap({ neighborhoods, selectedId, onSelect }: NeighborhoodMapProps) {
  useEffect(() => {
    // Fix Leaflet default icon paths broken by bundlers
    delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
      iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
      shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
    });
  }, []);

  return (
    <div
      className="w-full h-full rounded-xl overflow-hidden"
      role="application"
      aria-label="Tokyo neighborhoods map"
    >
      <MapContainer
        center={[35.6762, 139.6503]}
        zoom={12}
        style={{ height: "100%", width: "100%" }}
        zoomControl={true}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {neighborhoods.map((nb) => (
          <Marker
            key={nb.id}
            position={[nb.centroidLat, nb.centroidLng]}
            icon={makeIcon(selectedId === nb.id)}
            eventHandlers={{
              click: () => onSelect(nb.id),
            }}
          >
            <Popup>
              <button
                onClick={() => onSelect(nb.id)}
                className="font-semibold text-sm"
                style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}
              >
                {nb.name}
              </button>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
