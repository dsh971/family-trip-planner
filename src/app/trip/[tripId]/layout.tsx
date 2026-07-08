import { BottomNav } from "@/components/ui/BottomNav";

interface Props {
  children: React.ReactNode;
  params: Promise<{ tripId: string }>;
}

export default async function TripLayout({ children, params }: Props) {
  const { tripId } = await params;

  return (
    <>
      {/* Scrollable content area between AppHeader (44px) and BottomNav (64px).
          Inline styles are used for structural layout — Tailwind scale classes
          are unreliable in this @source setup (see globals.css). */}
      <div
        style={{
          position: "fixed",
          top: "2.75rem",
          bottom: "4rem",
          left: 0,
          right: 0,
          overflowY: "auto",
        }}
      >
        {children}
      </div>
      <BottomNav tripId={tripId} />
    </>
  );
}
