import { MapPin } from "lucide-react";
import EditorialBackdrop from "@/components/ui/EditorialBackdrop";

// Desktop-only decorative right panel for Trip setup pages, matching
// Web-TripSetup.dc.html's split-pane structure (form column left, an
// illustrated panel with a pin and a contextual hint bar right) — the
// same list+panel pattern every other desktop page already uses, just
// with a purely decorative panel instead of a functional map, since
// nothing here is geocoded yet at this stage of the flow.
export default function TripSetupArt({ hint }: { hint: string }) {
  return (
    <div className="tripsetup-art-col" style={{ position: "relative" }}>
      <EditorialBackdrop variant="light" />
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
