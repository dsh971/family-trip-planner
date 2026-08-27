"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Input,
  Button,
  Alert,
  DatePicker,
  Skeleton,
} from "@sumiui/react";
import { Users, Heart, Clock, CalendarDays, Building2 } from "lucide-react";
import TripSetupArt from "@/components/ui/TripSetupArt";
import TripSetupSectionHeader from "@/components/ui/TripSetupSectionHeader";

interface PacingWindow {
  name: string;
  startTime: string;
  endTime: string;
}

interface Child {
  age: number;
}

export default function EditProfilePage() {
  const params = useParams<{ tripId: string }>();
  const tripId = params.tripId;
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Per-field errors, rendered next to the input they belong to via
  // Input/DatePicker's own errorText prop — see profile/page.tsx's
  // identical comment for the create route's version of this.
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const KNOWN_ERROR_FIELDS = new Set(["adultCount", "startDate", "endDate", "hotelAddress"]);

  function applyApiErrors(errs: Array<{ field: string; message: string }>) {
    const map: Record<string, string> = {};
    const unmapped: string[] = [];
    for (const e of errs) {
      if (KNOWN_ERROR_FIELDS.has(e.field) || e.field.startsWith("children[") || e.field.startsWith("pacingWindows")) {
        map[e.field] = e.message;
      } else {
        unmapped.push(`${e.field}: ${e.message}`);
      }
    }
    setFieldErrors(map);
    setError(unmapped.length > 0 ? unmapped.join("; ") : null);
  }

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
  const [destinationName, setDestinationName] = useState<string | null>(null);

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
        destinationName?: string;
        familyProfile: {
          adultCount: number;
          children: Child[];
          dietaryTags: string[];
          accessibilityTags: string[];
          pacingWindows: PacingWindow[];
        };
      };

      setDestinationName(data.destinationName ?? null);
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
    setFieldErrors({});
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
        if (json.errors) applyApiErrors(json.errors);
        else setError("Update failed");
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
          className="tripsetup-shell max-w-2xl mx-auto w-full px-6 pt-4 pb-8"
        >
        <div className="tripsetup-layout">
        <div className="tripsetup-form-col space-y-4">
          <div className="mb-2">
            {/* Design-fidelity fix (2026-08-23): see neighborhoods/page.tsx's
                identical h1 comment — Sumi's unlayered h1 base rule always
                beats text-2xl/font-bold/tracking-tight utility classes. */}
            <h1
              style={{
                fontFamily: "var(--font-display)",
                fontSize: "1.5rem",
                fontWeight: 700,
                letterSpacing: "-0.025em",
                lineHeight: 1.2,
                color: "var(--fg-1)",
                margin: 0,
              }}
            >
              Edit Trip Profile
            </h1>
            <p className="text-sm mt-0.5" style={{ color: "var(--fg-2)" }}>
              Changes take effect the next time you run discovery.
            </p>
          </div>

          <form onSubmit={(e) => { void handleSubmit(e); }} className="space-y-6">
            {/* 1. Family Composition */}
            <div className="space-y-3">
              <TripSetupSectionHeader num={1} icon={<Users size={16} />} title="Family Composition" />
              <Input
                label="Adults"
                type="number"
                min={1}
                value={String(adultCount)}
                onChange={(e) => setAdultCount(Number(e.target.value))}
                errorText={fieldErrors.adultCount}
                className="w-24 bg-bg-card rounded-xl h-12 px-3.5"
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
                      errorText={fieldErrors[`children[${i}].age`]}
                      className="w-24 bg-bg-card rounded-xl h-12 px-3.5"
                    />
                    <button
                      type="button"
                      onClick={() => setChildren(children.filter((_, j) => j !== i))}
                      className="rounded-full px-4 py-2 text-sm font-medium transition-colors"
                      style={{ background: "transparent", color: "var(--fg-2)", border: "1px solid var(--line-2)" }}
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setChildren([...children, { age: 0 }])}
                  className="rounded-full px-4 py-2 text-sm font-medium transition-colors"
                  style={{ background: "transparent", color: "var(--fg-2)", border: "1px solid var(--line-2)" }}
                >
                  + Add child
                </button>
              </div>
            </div>

            {/* 2. Needs */}
            <div className="space-y-3">
              <TripSetupSectionHeader num={2} icon={<Heart size={16} />} title="Dietary & Accessibility Needs" />
              <Input
                label="Dietary tags (comma-separated)"
                value={dietaryTags}
                onChange={(e) => setDietaryTags(e.target.value)}
                placeholder="e.g. vegetarian, nut-allergy"
                className="bg-bg-card rounded-xl h-12 px-3.5"
              />
              <Input
                label="Accessibility needs (comma-separated)"
                value={accessibilityTags}
                onChange={(e) => setAccessibilityTags(e.target.value)}
                placeholder="e.g. stroller, wheelchair"
                className="bg-bg-card rounded-xl h-12 px-3.5"
              />
            </div>

            {/* 3. Pacing Blocks */}
            <div className="space-y-3">
              <TripSetupSectionHeader num={3} icon={<Clock size={16} />} title="Daily Pacing Blocks" />
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
                    className="w-28 bg-bg-card rounded-xl h-12 px-3.5"
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
                    errorText={fieldErrors[`pacingWindows[${i}]`]}
                    className="w-32 bg-bg-card rounded-xl h-12 px-3.5"
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
                    className="w-32 bg-bg-card rounded-xl h-12 px-3.5"
                  />
                  <button
                    type="button"
                    onClick={() => setPacingWindows(pacingWindows.filter((_, j) => j !== i))}
                    className="rounded-full px-4 py-2 text-sm font-medium transition-colors"
                    style={{ background: "transparent", color: "var(--fg-2)", border: "1px solid var(--line-2)" }}
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setPacingWindows([...pacingWindows, { name: "", startTime: "12:00", endTime: "13:00" }])}
                className="rounded-full px-4 py-2 text-sm font-medium transition-colors"
                style={{ background: "transparent", color: "var(--fg-2)", border: "1px solid var(--line-2)" }}
              >
                + Add pacing block
              </button>
              {fieldErrors.pacingWindows && (
                <p className="mt-1 text-xs" style={{ color: "var(--status-danger)" }} role="alert">
                  {fieldErrors.pacingWindows}
                </p>
              )}
            </div>

            {/* 4. Trip Dates */}
            <div className="space-y-3">
              <TripSetupSectionHeader num={4} icon={<CalendarDays size={16} />} title="Trip Dates" />
              <div className="flex gap-4 flex-wrap tripsetup-date-pill">
                <DatePicker
                  label="Start date"
                  value={startDate ?? ""}
                  onChange={(v) => setStartDate(v || undefined)}
                  errorText={fieldErrors.startDate}
                />
                <DatePicker
                  label="End date"
                  value={endDate ?? ""}
                  onChange={(v) => setEndDate(v || undefined)}
                  errorText={fieldErrors.endDate}
                />
              </div>
            </div>

            {/* 5. Hotel */}
            <div className="space-y-3">
              <TripSetupSectionHeader num={5} icon={<Building2 size={16} />} title="Pre-Booked Hotel" />
              <p className="text-xs" style={{ color: "var(--fg-3)" }}>Optional — helps us optimize your walking routes.</p>
              <Input
                label="Hotel name"
                value={hotelName}
                onChange={(e) => setHotelName(e.target.value)}
                placeholder="e.g. Park Hyatt Tokyo"
                className="bg-bg-card rounded-xl h-12 px-3.5"
              />
              <Input
                label="Hotel address"
                value={hotelAddress}
                onChange={(e) => setHotelAddress(e.target.value)}
                placeholder="e.g. 3-7-1-2 Nishi Shinjuku"
                errorText={fieldErrors.hotelAddress}
                className="bg-bg-card rounded-xl h-12 px-3.5"
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
            </div>

            {error && <Alert variant="danger">{error}</Alert>}

            {/* In-flow now, not a fixed bottom bar — Save changes is a real
                descendant of this form, so type="submit" triggers onSubmit
                natively; no more form="" + manual
                document.querySelector("form") relay. */}
            <div className="flex gap-3">
              <Button
                type="button"
                variant="secondary"
                size="lg"
                className="flex-1 rounded-xl"
                // Fixed destination, not router.back() — this page's WebNav
                // "Trip setup" tab is reachable from every other trip page
                // (Discover, Decisions, Itinerary, Neighborhoods), so
                // history-based back replays wherever the traveler happened
                // to arrive from rather than a predictable place. Same
                // reasoning AppHeader.tsx's backHref already documents for
                // its own back arrow; Cancel just hadn't followed it yet.
                onClick={() => router.push(`/trip/${tripId}/neighborhoods`)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="lg"
                loading={submitting}
                className="flex-1 rounded-xl"
              >
                {submitting ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </form>
        </div>
        <TripSetupArt
          destinationName={destinationName ?? ""}
          hint={destinationName ? `Editing your ${destinationName} trip` : "Editing your trip"}
        />
        </div>
        </main>
    </>
  );
}
