"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Card,
  CardBody,
  Input,
  Button,
  Alert,
  DatePicker,
  Skeleton,
} from "@sumiui/react";
import { Users, Heart, Clock, CalendarDays, Building2 } from "lucide-react";
import StepProgress from "@/components/ui/StepProgress";

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
        style={{ background: "var(--accent)", color: "var(--fg-on-malachite)" }}
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

export default function EditProfilePage() {
  const params = useParams<{ tripId: string }>();
  const tripId = params.tripId;
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [adultCount, setAdultCount] = useState(2);
  const [children, setChildren] = useState<Child[]>([]);
  const [dietaryTags, setDietaryTags] = useState("");
  const [accessibilityTags, setAccessibilityTags] = useState("");
  const [pacingWindows, setPacingWindows] = useState<PacingWindow[]>([]);
  const [startDate, setStartDate] = useState<string | undefined>(undefined);
  const [endDate, setEndDate] = useState<string | undefined>(undefined);
  const [hotelName, setHotelName] = useState("");
  const [hotelAddress, setHotelAddress] = useState("");
  const [staysEntireTrip, setStaysEntireTrip] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/trips/${tripId}`);
      if (!res.ok) throw new Error(`Failed to load trip (${res.status})`);
      const data = await res.json() as {
        startDate: string;
        endDate: string;
        hotelName: string | null;
        lodgingAnchorLat: number | null;
        lodgingAnchorAddress: string | null;
        familyProfile: {
          adultCount: number;
          children: Child[];
          dietaryTags: string[];
          accessibilityTags: string[];
          pacingWindows: PacingWindow[];
        };
      };

      setAdultCount(data.familyProfile.adultCount);
      setChildren(data.familyProfile.children);
      setDietaryTags(data.familyProfile.dietaryTags.join(", "));
      setAccessibilityTags(data.familyProfile.accessibilityTags.join(", "));
      setPacingWindows(data.familyProfile.pacingWindows);
      setStartDate(data.startDate);
      setEndDate(data.endDate);
      setHotelName(data.hotelName ?? "");
      setHotelAddress(data.lodgingAnchorAddress ?? "");
      setStaysEntireTrip(data.lodgingAnchorLat !== null || data.hotelName === null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load trip");
    } finally {
      setLoading(false);
    }
  }, [tripId]);

  useEffect(() => { void load(); }, [load]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch(`/api/trips/${tripId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adultCount,
          children,
          dietaryTags: dietaryTags.split(",").map((s) => s.trim()).filter(Boolean),
          accessibilityTags: accessibilityTags.split(",").map((s) => s.trim()).filter(Boolean),
          pacingWindows,
          startDate: startDate ?? "",
          endDate: endDate ?? "",
          hotelName: hotelName || undefined,
          hotelAddress: (hotelAddress && staysEntireTrip) ? hotelAddress : undefined,
        }),
      });

      if (!res.ok) {
        const json = await res.json() as { errors?: Array<{ field: string; message: string }> };
        setError(json.errors?.map((e) => `${e.field}: ${e.message}`).join("; ") ?? "Update failed");
        return;
      }

      router.push(`/trip/${tripId}/neighborhoods`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <main className="max-w-2xl mx-auto w-full px-6 space-y-4" style={{ paddingTop: "1rem" }}>
        <Skeleton height="2rem" width="18rem" />
        {[1, 2, 3].map((n) => <Skeleton key={n} height="10rem" />)}
      </main>
    );
  }

  return (
    <>
        <main
          className="max-w-2xl mx-auto w-full px-6 space-y-4"
          style={{ paddingTop: "1rem", paddingBottom: "calc(77px + 2rem)" }}
        >
          <div className="mb-4">
            <StepProgress currentStep="profile" tripId={tripId} />
          </div>

          <div className="mb-2">
            <h1
              className="text-2xl font-bold tracking-tight"
              style={{ fontFamily: "var(--font-display)", color: "var(--fg-1)" }}
            >
              Edit Trip Profile
            </h1>
            <p className="text-sm mt-0.5" style={{ color: "var(--fg-2)" }}>
              Changes take effect the next time you run discovery.
            </p>
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

            {error && <Alert variant="danger">{error}</Alert>}
          </form>
        </main>

      {/* Fixed CTA bar — sits above the 4rem bottom nav */}
      <div
        className="fixed left-0 right-0 p-4 z-50"
        style={{ bottom: "4rem", background: "var(--bg-0)", borderTop: "1px solid var(--line-1)" }}
      >
        <div className="max-w-2xl mx-auto flex gap-3">
          <Button
            type="button"
            variant="secondary"
            size="lg"
            className="flex-1"
            onClick={() => router.back()}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            form=""
            variant="primary"
            size="lg"
            loading={submitting}
            className="flex-1"
            onClick={(e) => {
              e.preventDefault();
              const form = document.querySelector("form");
              form?.requestSubmit();
            }}
          >
            {submitting ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </div>
    </>
  );
}
