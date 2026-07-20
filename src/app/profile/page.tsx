"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardBody,
  Input,
  Button,
  Alert,
  DatePicker,
} from "@sumiui/react";
import { Users, Heart, Clock, CalendarDays, Building2 } from "lucide-react";

interface PacingWindow {
  name: string;
  startTime: string;
  endTime: string;
}

interface Child {
  age: number;
}

function SectionHeader({
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
      <h2
        className="text-base font-semibold tracking-tight"
        style={{ fontFamily: "var(--font-display)", color: "var(--fg-1)" }}
      >
        {title}
      </h2>
    </div>
  );
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
  const [staysEntireTrip, setStaysEntireTrip] = useState(true);
  const [startDate, setStartDate] = useState<string | undefined>(undefined);
  const [endDate, setEndDate] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
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

      const tripRes = await fetch("/api/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          familyProfileId: profile.id,
          destinationId: 1,
          startDate: startDate ?? "",
          endDate: endDate ?? "",
          hotelName: hotelName || undefined,
          hotelAddress: (hotelAddress && staysEntireTrip) ? hotelAddress : undefined,
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
    <>
      {/* Scrollable content area between AppHeader (44px) and CTA bar (77px).
          Inline styles for structural layout — see globals.css for rationale. */}
      <div
        style={{
          position: "fixed",
          top: "2.75rem",
          bottom: "77px",
          left: 0,
          right: 0,
          overflowY: "auto",
        }}
      >
      <main
        className="max-w-2xl mx-auto w-full px-6 space-y-4"
        style={{ paddingTop: "1rem", paddingBottom: "1.5rem" }}
      >
        <div className="mb-2">
          <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: "var(--accent)" }}>
            Tokyo, Japan
          </p>
          <h1
            className="text-3xl font-bold tracking-tight"
            style={{ fontFamily: "var(--font-display)", color: "var(--fg-1)" }}
          >
            Set Up Your Trip
          </h1>
        </div>

        <form onSubmit={(e) => { void handleSubmit(e); }} className="space-y-4">
          {/* 1. Family Composition */}
          <Card>
            <CardBody className="space-y-3">
              <SectionHeader num={1} icon={<Users size={16} />} title="Family Composition" />
              <Input
                label="Adults"
                type="number"
                min={1}
                value={String(adultCount)}
                onChange={(e) => setAdultCount(Number(e.target.value))}
                className="w-24"
              />
              <div className="space-y-2">
                <p className="text-sm font-medium" style={{ color: "var(--fg-2)" }}>Children (ages)</p>
                {children.map((child, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      label={`Child ${i + 1} age`}
                      type="number"
                      min={0}
                      max={17}
                      value={String(child.age)}
                      onChange={(e) => {
                        const updated = [...children];
                        updated[i] = { age: Number(e.target.value) };
                        setChildren(updated);
                      }}
                      className="w-24"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setChildren(children.filter((_, j) => j !== i))}
                    >
                      Remove
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setChildren([...children, { age: 0 }])}
                >
                  + Add child
                </Button>
              </div>
            </CardBody>
          </Card>

          {/* 2. Needs */}
          <Card>
            <CardBody className="space-y-3">
              <SectionHeader num={2} icon={<Heart size={16} />} title="Dietary & Accessibility Needs" />
              <Input
                label="Dietary tags (comma-separated)"
                value={dietaryTags}
                onChange={(e) => setDietaryTags(e.target.value)}
                placeholder="e.g. vegetarian, nut-allergy"
              />
              <Input
                label="Accessibility needs (comma-separated)"
                value={accessibilityTags}
                onChange={(e) => setAccessibilityTags(e.target.value)}
                placeholder="e.g. stroller, wheelchair"
              />
            </CardBody>
          </Card>

          {/* 3. Pacing Blocks */}
          <Card>
            <CardBody className="space-y-3">
              <SectionHeader num={3} icon={<Clock size={16} />} title="Daily Pacing Blocks" />
              {pacingWindows.map((w, i) => (
                <div key={i} className="flex items-center gap-2 flex-wrap">
                  <Input
                    label="Name"
                    value={w.name}
                    onChange={(e) => {
                      const updated = [...pacingWindows];
                      updated[i] = { ...w, name: e.target.value };
                      setPacingWindows(updated);
                    }}
                    placeholder="name"
                    className="w-28"
                  />
                  <Input
                    label="Start"
                    type="time"
                    value={w.startTime}
                    onChange={(e) => {
                      const updated = [...pacingWindows];
                      updated[i] = { ...w, startTime: e.target.value };
                      setPacingWindows(updated);
                    }}
                    className="w-32"
                  />
                  <Input
                    label="End"
                    type="time"
                    value={w.endTime}
                    onChange={(e) => {
                      const updated = [...pacingWindows];
                      updated[i] = { ...w, endTime: e.target.value };
                      setPacingWindows(updated);
                    }}
                    className="w-32"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setPacingWindows(pacingWindows.filter((_, j) => j !== i))}
                  >
                    Remove
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setPacingWindows([...pacingWindows, { name: "", startTime: "12:00", endTime: "13:00" }])}
              >
                + Add pacing block
              </Button>
            </CardBody>
          </Card>

          {/* 4. Trip Dates */}
          <Card>
            <CardBody className="space-y-3">
              <SectionHeader num={4} icon={<CalendarDays size={16} />} title="Trip Dates" />
              <div className="flex gap-4 flex-wrap">
                <DatePicker
                  label="Start date"
                  value={startDate ?? ""}
                  onChange={(v) => setStartDate(v || undefined)}
                />
                <DatePicker
                  label="End date"
                  value={endDate ?? ""}
                  onChange={(v) => setEndDate(v || undefined)}
                />
              </div>
            </CardBody>
          </Card>

          {/* 5. Hotel */}
          <Card>
            <CardBody className="space-y-3">
              <SectionHeader num={5} icon={<Building2 size={16} />} title="Pre-Booked Hotel" />
              <p className="text-xs" style={{ color: "var(--fg-3)" }}>Optional — helps us optimize your walking routes.</p>
              <Input
                label="Hotel name"
                value={hotelName}
                onChange={(e) => setHotelName(e.target.value)}
                placeholder="e.g. Park Hyatt Tokyo"
              />
              <Input
                label="Hotel address"
                value={hotelAddress}
                onChange={(e) => setHotelAddress(e.target.value)}
                placeholder="e.g. 3-7-1-2 Nishi Shinjuku"
              />
              {hotelName && (
                <label
                  className="flex items-start gap-2 cursor-pointer"
                  style={{ paddingTop: "4px" }}
                >
                  <input
                    type="checkbox"
                    checked={staysEntireTrip}
                    onChange={(e) => setStaysEntireTrip(e.target.checked)}
                    style={{ marginTop: "2px", accentColor: "var(--accent)", flexShrink: 0 }}
                  />
                  <span className="text-sm" style={{ color: "var(--fg-2)" }}>
                    We'll be staying here for the whole trip
                    <span className="block text-xs mt-0.5" style={{ color: "var(--fg-3)" }}>
                      Uncheck if you have multiple accommodations — we'll use the neighborhood center for distance estimates instead.
                    </span>
                  </span>
                </label>
              )}
            </CardBody>
          </Card>

          {error && (
            <Alert variant="danger">{error}</Alert>
          )}
        </form>
      </main>
      </div>

      {/* Fixed CTA bar (77px tall: p-4 × 2 + Button lg 45px) */}
      <div
        className="fixed bottom-0 left-0 right-0 p-4 z-40"
        style={{ background: "var(--bg-0)", borderTop: "1px solid var(--line-1)" }}
      >
        <div className="max-w-2xl mx-auto">
          <Button
            type="submit"
            form=""
            variant="primary"
            size="lg"
            loading={submitting}
            className="w-full"
            onClick={(e) => {
              e.preventDefault();
              const form = document.querySelector("form");
              form?.requestSubmit();
            }}
          >
            {submitting ? "Setting up your trip…" : "Start Planning"}
          </Button>
        </div>
      </div>
    </>
  );
}
