export default function TripSetupSectionHeader({
  num,
  icon,
  title,
}: {
  num: number;
  icon: React.ReactNode;
  title: string;
}) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <span
        className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
        style={{
          background: "var(--accent)",
          color: "var(--fg-on-malachite)",
        }}
      >
        {num}
      </span>
      <span style={{ color: "var(--accent)" }}>{icon}</span>
      {/* Design-fidelity fix (2026-08-23): Sumi's own base CSS sets h2's
          font-size/weight/tracking/line-height/margin unconditionally and
          UNLAYERED, which always beats layered utility classes (CSS Cascade
          Layers spec) regardless of specificity — text-base/font-semibold/
          tracking-tight silently did nothing here. Explicit inline style is
          the reliable override. */}
      <h2
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "1rem",
          fontWeight: 700,
          letterSpacing: "-0.025em",
          lineHeight: 1.375,
          color: "var(--fg-1)",
          margin: 0,
        }}
      >
        {title}
      </h2>
    </div>
  );
}
