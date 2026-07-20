import Link from "next/link";

type Step = "profile" | "area" | "discover" | "plan";

const STEPS: { id: Step; label: string }[] = [
  { id: "profile", label: "Profile" },
  { id: "area", label: "Area" },
  { id: "discover", label: "Discover" },
  { id: "plan", label: "Plan" },
];

function stepUrl(step: Step, tripId: string): string | null {
  switch (step) {
    case "profile": return `/trip/${tripId}/profile`;
    case "area": return `/trip/${tripId}/neighborhoods`;
    case "discover": return `/trip/${tripId}/discovery`;
    case "plan": return `/trip/${tripId}/itinerary`;
  }
}

export default function StepProgress({ currentStep, tripId }: { currentStep: Step; tripId?: string }) {
  const currentIndex = STEPS.findIndex((s) => s.id === currentStep);

  return (
    <div
      className="flex items-center gap-1 text-xs flex-wrap"
      style={{ color: "var(--fg-3)" }}
      aria-label="Trip planning steps"
    >
      {STEPS.map((step, i) => {
        const isDone = i < currentIndex;
        const isActive = i === currentIndex;
        const url = isDone && tripId ? stepUrl(step.id, tripId) : null;

        return (
          <span key={step.id} className="flex items-center gap-1">
            {i > 0 && <span aria-hidden="true">→</span>}
            {url ? (
              <Link
                href={url}
                style={{ color: "var(--accent)", textDecoration: "none" }}
              >
                ✓ {step.label}
              </Link>
            ) : (
              <span
                className={isActive ? "font-semibold" : ""}
                style={{
                  color: isDone
                    ? "var(--accent)"
                    : isActive
                      ? "var(--fg-1)"
                      : "var(--fg-3)",
                }}
              >
                {isDone ? "✓" : isActive ? "●" : "○"} {step.label}
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}
