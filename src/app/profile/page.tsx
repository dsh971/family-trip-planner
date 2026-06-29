"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface PacingWindow {
  name: string;
  startTime: string;
  endTime: string;
}

interface Child {
  age: number;
}

export default function ProfilePage() {
  const router = useRouter();
  const [adultCount, setAdultCount] = useState(2);
  const [children, setChildren] = useState<Child[]>([{ age: 4 }, { age: 7 }]);
  const [dietaryTags, setDietaryTags] = useState("");
  const [accessibilityTags, setAccessibilityTags] = useState("");
  const [pacingWindows, setPacingWindows] = useState<PacingWindow[]>([
    { name: "nap", startTime: "13:00", endTime: "15:00" },
    { name: "bedtime", startTime: "19:30", endTime: "23:59" },
  ]);
  const [hotelName, setHotelName] = useState("");
  const [hotelAddress, setHotelAddress] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      // Step 1: create profile
      const profileRes = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adultCount,
          children,
          dietaryTags: dietaryTags.split(",").map((s) => s.trim()).filter(Boolean),
          accessibilityTags: accessibilityTags.split(",").map((s) => s.trim()).filter(Boolean),
          pacingWindows,
        }),
      });

      if (!profileRes.ok) {
        const json = await profileRes.json() as { errors?: Array<{ field: string; message: string }> };
        setError(json.errors?.map((e) => `${e.field}: ${e.message}`).join("; ") ?? "Profile creation failed");
        return;
      }

      const profile = await profileRes.json() as { id: number };

      // Step 2: create trip
      const tripRes = await fetch("/api/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          familyProfileId: profile.id,
          destinationId: 1, // Tokyo is always destination 1 in v1
          startDate,
          endDate,
          hotelName: hotelName || undefined,
          hotelAddress: hotelAddress || undefined,
        }),
      });

      if (!tripRes.ok) {
        const json = await tripRes.json() as { errors?: Array<{ field: string; message: string }> };
        setError(json.errors?.map((e) => `${e.field}: ${e.message}`).join("; ") ?? "Trip creation failed");
        return;
      }

      const trip = await tripRes.json() as { id: number };
      router.push(`/trip/${trip.id}/neighborhoods`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">Set Up Your Tokyo Trip</h1>
      <form onSubmit={(e) => { void handleSubmit(e); }} className="space-y-6">
        <section>
          <h2 className="text-lg font-semibold mb-3">Family Composition</h2>
          <label className="block mb-2">
            Adults
            <input
              type="number"
              min={1}
              value={adultCount}
              onChange={(e) => setAdultCount(Number(e.target.value))}
              className="ml-2 border rounded px-2 py-1 w-16"
            />
          </label>
          <div>
            <p className="mb-1">Children (ages)</p>
            {children.map((child, i) => (
              <label key={i} className="block mb-1">
                Child {i + 1} age:
                <input
                  type="number"
                  min={0}
                  max={17}
                  value={child.age}
                  onChange={(e) => {
                    const updated = [...children];
                    updated[i] = { age: Number(e.target.value) };
                    setChildren(updated);
                  }}
                  className="ml-2 border rounded px-2 py-1 w-16"
                />
                <button
                  type="button"
                  onClick={() => setChildren(children.filter((_, j) => j !== i))}
                  className="ml-2 text-red-600 text-sm"
                >
                  Remove
                </button>
              </label>
            ))}
            <button
              type="button"
              onClick={() => setChildren([...children, { age: 0 }])}
              className="text-blue-600 text-sm mt-1"
            >
              + Add child
            </button>
          </div>
        </section>

        <section>
          <h2 className="text-lg font-semibold mb-3">Needs</h2>
          <label className="block mb-2">
            Dietary tags (comma-separated)
            <input
              type="text"
              value={dietaryTags}
              onChange={(e) => setDietaryTags(e.target.value)}
              placeholder="e.g. vegetarian, nut-allergy"
              className="block w-full border rounded px-2 py-1 mt-1"
            />
          </label>
          <label className="block">
            Accessibility needs (comma-separated)
            <input
              type="text"
              value={accessibilityTags}
              onChange={(e) => setAccessibilityTags(e.target.value)}
              placeholder="e.g. stroller, wheelchair"
              className="block w-full border rounded px-2 py-1 mt-1"
            />
          </label>
        </section>

        <section>
          <h2 className="text-lg font-semibold mb-3">Daily Pacing Blocks</h2>
          {pacingWindows.map((w, i) => (
            <div key={i} className="flex items-center gap-2 mb-2">
              <input
                type="text"
                value={w.name}
                onChange={(e) => {
                  const updated = [...pacingWindows];
                  updated[i] = { ...w, name: e.target.value };
                  setPacingWindows(updated);
                }}
                placeholder="name"
                className="border rounded px-2 py-1 w-24"
              />
              <input
                type="time"
                value={w.startTime}
                onChange={(e) => {
                  const updated = [...pacingWindows];
                  updated[i] = { ...w, startTime: e.target.value };
                  setPacingWindows(updated);
                }}
                className="border rounded px-2 py-1"
              />
              <span>–</span>
              <input
                type="time"
                value={w.endTime}
                onChange={(e) => {
                  const updated = [...pacingWindows];
                  updated[i] = { ...w, endTime: e.target.value };
                  setPacingWindows(updated);
                }}
                className="border rounded px-2 py-1"
              />
              <button
                type="button"
                onClick={() => setPacingWindows(pacingWindows.filter((_, j) => j !== i))}
                className="text-red-600 text-sm"
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setPacingWindows([...pacingWindows, { name: "", startTime: "12:00", endTime: "13:00" }])}
            className="text-blue-600 text-sm"
          >
            + Add pacing block
          </button>
        </section>

        <section>
          <h2 className="text-lg font-semibold mb-3">Trip Dates</h2>
          <div className="flex gap-4">
            <label>
              Start date
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                required
                className="block border rounded px-2 py-1 mt-1"
              />
            </label>
            <label>
              End date
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                required
                className="block border rounded px-2 py-1 mt-1"
              />
            </label>
          </div>
        </section>

        <section>
          <h2 className="text-lg font-semibold mb-3">
            Pre-Booked Hotel{" "}
            <span className="text-sm font-normal text-gray-500">(optional — improves itinerary accuracy)</span>
          </h2>
          <label className="block mb-2">
            Hotel name
            <input
              type="text"
              value={hotelName}
              onChange={(e) => setHotelName(e.target.value)}
              placeholder="e.g. Park Hyatt Tokyo"
              className="block w-full border rounded px-2 py-1 mt-1"
            />
          </label>
          <label className="block">
            Hotel address
            <input
              type="text"
              value={hotelAddress}
              onChange={(e) => setHotelAddress(e.target.value)}
              placeholder="e.g. 3-7-1-2 Nishi Shinjuku, Shinjuku"
              className="block w-full border rounded px-2 py-1 mt-1"
            />
          </label>
        </section>

        {error && (
          <div className="bg-red-50 border border-red-300 text-red-700 rounded p-3 text-sm">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full bg-blue-600 text-white rounded px-4 py-2 font-semibold disabled:opacity-50"
        >
          {submitting ? "Setting up your trip…" : "Start Planning"}
        </button>
      </form>
    </main>
  );
}
