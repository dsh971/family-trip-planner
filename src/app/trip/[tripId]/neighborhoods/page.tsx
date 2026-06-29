"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

interface DayInTheLifePreview {
  highlights: string[];
  safetyNote: string;
  sampleBundle: string;
}

interface RankedNeighborhood {
  id: number;
  name: string;
  familyFriendlinessScore: number;
  rankingScore: number;
  safetyPenalty: number;
  dayInTheLifePreview: DayInTheLifePreview;
  walkingRadiusMeters: number;
}

export default function NeighborhoodsPage() {
  const { tripId } = useParams<{ tripId: string }>();
  const router = useRouter();
  const [neighborhoods, setNeighborhoods] = useState<RankedNeighborhood[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/neighborhoods?destinationId=1");
      if (!res.ok) {
        setError("Failed to load neighborhoods");
        setLoading(false);
        return;
      }
      const data = await res.json() as RankedNeighborhood[];
      setNeighborhoods(data);
      setLoading(false);
    })();
  }, []);

  async function handleSelect(neighborhoodId: number) {
    setSelected(neighborhoodId);
    const res = await fetch("/api/neighborhoods", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tripId: Number(tripId), neighborhoodId }),
    });
    if (!res.ok) {
      setError("Failed to select neighborhood");
      return;
    }
    router.push(`/trip/${tripId}/discovery`);
  }

  if (loading) return <main className="max-w-2xl mx-auto p-6">Loading neighborhoods…</main>;
  if (error) return <main className="max-w-2xl mx-auto p-6 text-red-600">{error}</main>;

  return (
    <main className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-2">Choose Your Tokyo Base</h1>
      <p className="text-gray-600 mb-6">
        These neighborhoods are ranked for family-friendliness. Pick one as your base area for the trip.
      </p>
      <div className="space-y-4">
        {neighborhoods.map((nb, i) => (
          <div
            key={nb.id}
            className={`border rounded-lg p-4 ${selected === nb.id ? "border-blue-500 bg-blue-50" : "border-gray-200"}`}
          >
            <div className="flex justify-between items-start mb-2">
              <div>
                <span className="text-xs text-gray-400 font-medium mr-2">#{i + 1}</span>
                <span className="font-semibold text-lg">{nb.name}</span>
                {nb.safetyPenalty > 0 && (
                  <span className="ml-2 text-xs bg-yellow-100 text-yellow-800 rounded px-1 py-0.5">
                    Near flagged area
                  </span>
                )}
              </div>
              <button
                onClick={() => { void handleSelect(nb.id); }}
                className="bg-blue-600 text-white px-3 py-1 rounded text-sm font-medium"
              >
                Select
              </button>
            </div>
            <div className="text-sm text-gray-700 space-y-1">
              <p className="font-medium">Highlights:</p>
              <ul className="list-disc list-inside ml-2">
                {nb.dayInTheLifePreview.highlights.map((h, j) => (
                  <li key={j}>{h}</li>
                ))}
              </ul>
              <p className="mt-2">
                <span className="font-medium">Sample day:</span> {nb.dayInTheLifePreview.sampleBundle}
              </p>
              {nb.dayInTheLifePreview.safetyNote && (
                <p className="text-gray-500 text-xs mt-1">ℹ {nb.dayInTheLifePreview.safetyNote}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
