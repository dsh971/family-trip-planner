"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { MapPin } from "lucide-react";
import EditorialBackdrop from "@/components/ui/EditorialBackdrop";

// ssr:false — react-leaflet touches `window` at module init (same reason
// DiscoveryMap/NeighborhoodMap/RouteMap are all dynamically imported).
const DestinationPreviewMap = dynamic(
  () => import("@/components/ui/DestinationPreviewMap"),
  { ssr: false }
);

const GEOCODE_DEBOUNCE_MS = 500;

// Desktop-only decorative right panel for Trip setup pages, matching
// Web-TripSetup.dc.html's split-pane structure (form column left, an
// illustrated panel with a pin and a contextual hint bar right). The
// mockup's own panel is purely decorative (no real map, just a static
// illustration) — extended here to show an actual map once a real city is
// known, since this app already has live geocoding infrastructure
// (geocodeHotelAddress's Google Places lookup, generalized into
// geocodeCity) and showing nothing real for an already-selected
// destination read as broken rather than intentional. Falls back to the
// mockup's illustrated treatment while no destination is set yet, or if
// geocoding a partially-typed name comes back empty.
export default function TripSetupArt({
  destinationName,
  destinationCountry,
  hint,
}: {
  destinationName: string;
  destinationCountry?: string;
  hint: string;
}) {
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const name = destinationName.trim();
    if (!name) {
      setCoords(null);
      return;
    }

    debounceRef.current = setTimeout(() => {
      const params = new URLSearchParams({ city: name });
      if (destinationCountry?.trim()) params.set("country", destinationCountry.trim());
      fetch(`/api/geocode?${params.toString()}`)
        .then((res) => (res.ok ? (res.json() as Promise<{ lat: number; lng: number }>) : null))
        .then((result) => setCoords(result))
        .catch(() => setCoords(null));
    }, GEOCODE_DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [destinationName, destinationCountry]);

  return (
    <div className="tripsetup-art-col" style={{ position: "relative" }}>
      {coords ? (
        <DestinationPreviewMap lat={coords.lat} lng={coords.lng} />
      ) : (
        <EditorialBackdrop variant="light" />
      )}
      <div
        style={{
          position: "absolute",
          top: "32px",
          left: "32px",
          right: "32px",
          borderRadius: "12px",
          background: "var(--bg-1)",
          boxShadow: "0 2px 10px rgba(28,27,26,0.1)",
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "12px 16px",
          fontSize: "13.5px",
          fontWeight: 600,
          color: "var(--fg-2)",
        }}
      >
        <MapPin size={15} style={{ color: "var(--accent)", flexShrink: 0 }} aria-hidden="true" />
        {hint}
      </div>
    </div>
  );
}
