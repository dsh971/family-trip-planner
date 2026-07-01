import { BottomNav } from "@/components/ui/BottomNav";

interface Props {
  children: React.ReactNode;
  params: Promise<{ tripId: string }>;
}

export default async function TripLayout({ children, params }: Props) {
  const { tripId } = await params;

  return (
    <div className="flex flex-col min-h-screen pt-11 pb-16">
      {children}
      <BottomNav tripId={tripId} />
    </div>
  );
}
