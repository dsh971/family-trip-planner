"use client";

import "leaflet/dist/leaflet.css";
import { useEffect } from "react";
import { MapContainer, TileLayer, Marker, useMap } from "react-leaflet";
import L from "leaflet";

export interface DiscoveryMapPlace {
  placeId: string;
  name: string;
  lat: number;
  lng: number;
  category: "eat" | "visit";
  worthTheDetour: boolean;
}

export interface DiscoveryMapProps {
  places: DiscoveryMapPlace[];
  selectedPlaceId: string | null;
  onPinClick: (placeId: string) => void;
  lodgingLat?: number | null;
  lodgingLng?: number | null;
}

function makeDiscoveryIcon(
  category: "eat" | "visit",
  isSelected: boolean,
  worthTheDetour: boolean,
) {
  const colorHex = category === "eat" ? "#f59e0b" : "#3b82f6";

  const classNames = [
    category === "eat" ? "pin-eat" : "pin-visit",
    isSelected ? "pin-selected" : "",
    worthTheDetour ? "pin-worth-the-detour" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const boxShadow = worthTheDetour
    ? `0 0 0 3px white, 0 0 0 4px ${colorHex}, 0 2px 6px rgba(0,0,0,0.35)`
    : "0 2px 6px rgba(0,0,0,0.35)";

  const transform = isSelected ? "scale(1.3)" : "none";

  return L.divIcon({
    className: classNames,
    html: `<div style="
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: ${colorHex};
      border: 1.5px solid white;
      box-shadow: ${boxShadow};
      transform: ${transform};
      cursor: pointer;
    "></div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
    popupAnchor: [0, -14],
  });
}

function makeHotelIcon() {
  return L.divIcon({
    className: "pin-hotel",
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

function BoundsFitter({ places }: { places: DiscoveryMapPlace[] }) {
  const map = useMap();
  const posStr = JSON.stringify(places.map((p) => [p.lat, p.lng]));
  useEffect(() => {
    if (places.length > 0) {
      const latLngs: [number, number][] = places.map((p) => [p.lat, p.lng]);
      map.fitBounds(latLngs as L.LatLngBoundsExpression, { padding: [20, 20] });
    }
    // posStr is the stable serialized form of places positions — intentional dep
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, posStr]);
  return null;
}

export default function DiscoveryMap({
  places,
  selectedPlaceId,
  onPinClick,
  lodgingLat,
  lodgingLng,
}: DiscoveryMapProps) {
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

  const hotelPosition: [number, number] | null =
    lodgingLat != null && lodgingLng != null
      ? [lodgingLat, lodgingLng]
      : null;

  return (
    <div
      className="w-full h-full rounded-xl overflow-hidden"
      role="application"
      aria-label="Discovery map"
    >
      <MapContainer
        center={[35.6762, 139.6503]}
        zoom={12}
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <BoundsFitter places={places} />

        {places.map((place) => (
          <Marker
            key={place.placeId}
            position={[place.lat, place.lng]}
            icon={makeDiscoveryIcon(
              place.category,
              place.placeId === selectedPlaceId,
              place.worthTheDetour,
            )}
            eventHandlers={{ click: () => onPinClick(place.placeId) }}
          />
        ))}

        {hotelPosition && (
          <Marker position={hotelPosition} icon={makeHotelIcon()} />
        )}
      </MapContainer>
    </div>
  );
}
