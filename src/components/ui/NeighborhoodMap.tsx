"use client";

import "leaflet/dist/leaflet.css";
import { useEffect } from "react";
import { MapContainer, TileLayer, Marker, Popup, Circle, useMap } from "react-leaflet";
import L from "leaflet";

interface NeighborhoodPin {
  id: number;
  name: string;
  centroidLat: number;
  centroidLng: number;
  walkingRadiusMeters: number;
  rankPosition: number;
}

interface NeighborhoodMapProps {
  neighborhoods: NeighborhoodPin[];
  selectedId: number | null;
  hoveredId: number | null;
  onSelect: (id: number) => void;
  onHover?: (id: number | null) => void;
  lodgingAnchorLat?: number | null;
  lodgingAnchorLng?: number | null;
}

function makeIcon(rank: number, selected: boolean, hovered: boolean) {
  const bg = selected
    ? "var(--accent, #2d9b6f)"
    : hovered
      ? "#444"
      : "#666";

  return L.divIcon({
    className: "",
    html: `<div style="
      width: 32px;
      height: 32px;
      border-radius: 50% 50% 50% 0;
      transform: rotate(-45deg);
      background: ${bg};
      border: 2px solid white;
      box-shadow: 0 2px 6px rgba(0,0,0,0.35);
      display: flex;
      align-items: center;
      justify-content: center;
    "><span style="
      display: block;
      transform: rotate(45deg);
      font-size: 11px;
      font-weight: 700;
      color: white;
      line-height: 1;
    ">${rank}</span></div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -34],
  });
}

function makeHotelIcon() {
  return L.divIcon({
    className: "",
    html: `<div style="
      width: 28px;
      height: 28px;
      background: var(--accent, #2d9b6f);
      border: 2px solid white;
      border-radius: 4px;
      box-shadow: 0 2px 6px rgba(0,0,0,.35);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      font-weight: 700;
      color: white;
    ">H</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -18],
  });
}

function BoundsFitter({ positions }: { positions: [number, number][] }) {
  const map = useMap();
  const posStr = JSON.stringify(positions);
  useEffect(() => {
    if (positions.length > 0) {
      map.fitBounds(positions as L.LatLngBoundsExpression, { padding: [40, 40] });
    }
    // posStr is the stable serialized form of positions — intentional dep
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, posStr]);
  return null;
}

export default function NeighborhoodMap({
  neighborhoods,
  selectedId,
  hoveredId,
  onSelect,
  onHover,
  lodgingAnchorLat,
  lodgingAnchorLng,
}: NeighborhoodMapProps) {
  useEffect(() => {
    delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
      iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
      shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
    });
  }, []);

  const centroidPositions: [number, number][] = neighborhoods.map((nb) => [nb.centroidLat, nb.centroidLng]);
  const hotelPosition: [number, number] | null =
    lodgingAnchorLat != null && lodgingAnchorLng != null
      ? [lodgingAnchorLat, lodgingAnchorLng]
      : null;
  const allPositions: [number, number][] = hotelPosition
    ? [...centroidPositions, hotelPosition]
    : centroidPositions;

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

        <BoundsFitter positions={allPositions} />

        {neighborhoods.map((nb) => {
          const isActive = selectedId === nb.id || hoveredId === nb.id;
          return (
            <Circle
              key={`circle-${nb.id}`}
              center={[nb.centroidLat, nb.centroidLng]}
              radius={nb.walkingRadiusMeters}
              pathOptions={{
                color: isActive ? "var(--accent, #2d9b6f)" : "#888",
                fillOpacity: 0.08,
                weight: 1.5,
              }}
            />
          );
        })}

        {neighborhoods.map((nb) => (
          <Marker
            key={nb.id}
            position={[nb.centroidLat, nb.centroidLng]}
            icon={makeIcon(nb.rankPosition, selectedId === nb.id, hoveredId === nb.id)}
            eventHandlers={{
              click: () => onSelect(nb.id),
              mouseover: () => onHover?.(nb.id),
              mouseout: () => onHover?.(null),
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

        {hotelPosition && (
          <Marker position={hotelPosition} icon={makeHotelIcon()}>
            <Popup>Your hotel</Popup>
          </Marker>
        )}
      </MapContainer>
    </div>
  );
}
