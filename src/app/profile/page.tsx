"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Input,
  Button,
  Alert,
  DatePicker,
} from "@sumiui/react";
import { Users, Heart, Clock, CalendarDays, Building2, MapPin } from "lucide-react";
import { setActiveTripId } from "@/lib/activeTrip";
import TripSetupArt from "@/components/ui/TripSetupArt";
import TripSetupSectionHeader from "@/components/ui/TripSetupSectionHeader";
import { WebNav } from "@/components/ui/WebNav";

interface PacingWindow {
  name: string;
  startTime: string;
  endTime: string;
}

interface Child {
  age: number;
}

interface DestinationSuggestion {
  id: number;
  name: string;
  country: string;
  slug: string;
}

// Debounce delay for the destination search-as-you-type query (U3, plan
// 2026-08-20-011). No shared debounce helper exists in this codebase yet —
// kept small and local to this component per the plan's guidance.
const DESTINATION_SEARCH_DEBOUNCE_MS = 200;

export default function ProfilePage() {
  const router = useRouter();
  const [destinationName, setDestinationName] = useState("");
  const [destinationCountry, setDestinationCountry] = useState("");
  // Set when the traveler picks an existing destination from the
  // search-as-you-type dropdown; cleared whenever they edit the name again
  // so a subsequent submit falls back to free-text create-new behavior.
  const [selectedDestinationId, setSelectedDestinationId] = useState<number | null>(null);
  const [destinationSuggestions, setDestinationSuggestions] = useState<DestinationSuggestion[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const destinationDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  // Per-field errors from the API's {field, message} validation shape,
  // rendered next to the input they belong to via Input/DatePicker's own
  // errorText prop instead of one generic banner at the bottom of the form.
  // `error` stays as a fallback for anything that doesn't map to a visible
  // field (a caught exception, or a field this form has no input for).
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  // Fields with a corresponding visible input — anything else falls back to
  // the general `error` banner instead of silently disappearing.
  const KNOWN_ERROR_FIELDS = new Set(["destinationId", "destinationName", "adultCount", "startDate", "endDate", "hotelAddress"]);

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

  // Design-fidelity fix (2026-08-22): Home's destination search hands off
  // the typed/selected destination via query params instead of making the
  // traveler retype it (src/app/page.tsx's handleStartNewTrip). Read once on
  // mount — window.location.search isn't available during SSR, and
  // re-reading on every render would fight the traveler's own subsequent
  // edits to the field.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const name = params.get("destinationName");
    const country = params.get("destinationCountry");
    const id = params.get("destinationId");
    if (name) setDestinationName(name);
    if (country) setDestinationCountry(country);
    if (id) {
      const parsed = Number(id);
      if (Number.isInteger(parsed) && parsed > 0) setSelectedDestinationId(parsed);
    }
  }, []);

  // Debounced search-as-you-type against GET /api/destinations?q= (U3, plan
  // 2026-08-20-011). Skips the query entirely once a suggestion has been
  // selected — see the Input's onChange, which clears selectedDestinationId
  // as soon as the traveler edits the name again. Clearing suggestions for
  // the "nothing to search" case happens in the onChange/selection handlers
  // themselves rather than here, so this effect never calls setState
  // synchronously in its body (only inside the debounced fetch callback).
  useEffect(() => {
    if (destinationDebounceRef.current) {
      clearTimeout(destinationDebounceRef.current);
    }

    const query = destinationName.trim();
    if (!query || selectedDestinationId !== null) {
      return;
    }

    destinationDebounceRef.current = setTimeout(() => {
      fetch(`/api/destinations?q=${encodeURIComponent(query)}`)
        .then((res) => (res.ok ? (res.json() as Promise<DestinationSuggestion[]>) : []))
        .then((results) => {
          setDestinationSuggestions(results);
          setSuggestionsOpen(results.length > 0);
        })
        .catch(() => {
          setDestinationSuggestions([]);
          setSuggestionsOpen(false);
        });
    }, DESTINATION_SEARCH_DEBOUNCE_MS);

    return () => {
      if (destinationDebounceRef.current) {
        clearTimeout(destinationDebounceRef.current);
      }
    };
  }, [destinationName, selectedDestinationId]);

  function selectDestinationSuggestion(suggestion: DestinationSuggestion) {
    setDestinationName(suggestion.name);
    setDestinationCountry(suggestion.country);
    setSelectedDestinationId(suggestion.id);
    setDestinationSuggestions([]);
    setSuggestionsOpen(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});

    if (!destinationName.trim()) {
      setFieldErrors({ destinationName: "Required" });
      return;
    }

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
        if (json.errors) applyApiErrors(json.errors);
        else setError("Profile creation failed");
        return;
      }

      const profile = await profileRes.json() as { id: number };

      // If the traveler picked a suggestion, send its real destinationId
      // directly rather than re-resolving by name (U3, plan 2026-08-20-011) —
      // this is what guarantees selecting an existing destination reuses its
      // row instead of racing findOrCreateDestination's own dedup-by-slug.
      // Otherwise, fall back to the free-text name/country path (U2's
      // stopgap, still handled by /api/trips) so a genuinely novel
      // destination still creates a new row on submit.
      const tripRes = await fetch("/api/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          familyProfileId: profile.id,
          ...(selectedDestinationId !== null
            ? { destinationId: selectedDestinationId }
            : {
                destinationName: destinationName.trim(),
                destinationCountry: destinationCountry.trim() || undefined,
              }),
          startDate: startDate ?? "",
          endDate: endDate ?? "",
          hotelName: hotelName || undefined,
          hotelAddress: (hotelAddress && staysEntireTrip) ? hotelAddress : undefined,
        }),
      });

      if (!tripRes.ok) {
        const json = await tripRes.json() as { errors?: Array<{ field: string; message: string }> };
        if (json.errors) applyApiErrors(json.errors);
        else setError("Trip creation failed");
        return;
      }

      const trip = await tripRes.json() as { id: number };
      // Design-fidelity fix (2026-08-22): lets Home recognize a returning
      // traveler on a later visit (src/app/page.tsx) — see that file for why
      // localStorage is the only client-side option here (no auth/session).
      setActiveTripId(trip.id);
      router.push(`/trip/${trip.id}/neighborhoods`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      {/* No tripId yet on this pre-trip route — WebNav renders with the
          wordmark and "Trip setup" active (its own /profile match), no
          trip-context chip, and Discover/Saved/Itinerary disabled until a
          trip exists. */}
      <WebNav />
      {/* Scrollable content area between AppHeader (44px) on mobile / WebNav
          (64px) at >=1024px and the viewport bottom — see
          `.profile-shell-inset` in globals.css. The "Start Planning" button
          is in-flow inside the form now, not a separate fixed bar, so this
          no longer reserves space for one. Inline styles for the rest of
          the structural layout — see globals.css for rationale. */}
      <div
        className="profile-shell-inset"
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          overflowY: "auto",
        }}
      >
      <main
        className="tripsetup-shell max-w-2xl mx-auto w-full px-6 pt-4 pb-8"
      >
      <div className="tripsetup-layout">
      <div className="tripsetup-form-col space-y-4">
        <div className="mb-2">
          {/* Design-fidelity fix (2026-08-23): see TripSetupSectionHeader's
              identical h2 comment — Sumi's unlayered h1 base rule always
              beats text-3xl/font-bold/tracking-tight utility classes. */}
          <h1
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "1.875rem",
              fontWeight: 700,
              letterSpacing: "-0.025em",
              lineHeight: 1.2,
              color: "var(--fg-1)",
              margin: 0,
            }}
          >
            Set Up Your Trip
          </h1>
        </div>

        <form onSubmit={(e) => { void handleSubmit(e); }} className="space-y-6">
          {/* 0. Destination */}
          <div className="space-y-3">
            <TripSetupSectionHeader num={1} icon={<MapPin size={16} />} title="Destination" />
            <div className="flex gap-2 flex-wrap">
              <div className="flex-1" style={{ position: "relative" }}>
                <Input
                  label="City"
                  value={destinationName}
                  onChange={(e) => {
                    const value = e.target.value;
                    setDestinationName(value);
                    setSelectedDestinationId(null);
                    if (!value.trim()) {
                      setDestinationSuggestions([]);
                      setSuggestionsOpen(false);
                    }
                  }}
                  onFocus={() => {
                    if (destinationSuggestions.length > 0) setSuggestionsOpen(true);
                  }}
                  onBlur={() => {
                    // Delay so a click on a suggestion (onMouseDown below)
                    // registers before the dropdown unmounts.
                    setTimeout(() => setSuggestionsOpen(false), 150);
                  }}
                  placeholder="e.g. Paris"
                  autoComplete="off"
                  aria-expanded={suggestionsOpen}
                  aria-autocomplete="list"
                  errorText={fieldErrors.destinationName ?? fieldErrors.destinationId}
                  className="bg-bg-card rounded-xl h-12 px-3.5"
                />
                {suggestionsOpen && destinationSuggestions.length > 0 && (
                  <ul
                    role="listbox"
                    aria-label="Matching destinations"
                    style={{
                      position: "absolute",
                      top: "100%",
                      left: 0,
                      right: 0,
                      marginTop: "4px",
                      background: "var(--bg-1)",
                      border: "1px solid var(--line-1)",
                      borderRadius: "8px",
                      boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
                      zIndex: 30,
                      maxHeight: "220px",
                      overflowY: "auto",
                      listStyle: "none",
                      margin: "4px 0 0 0",
                      padding: "4px",
                    }}
                  >
                    {destinationSuggestions.map((s) => (
                      <li key={s.id}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={selectedDestinationId === s.id}
                          onMouseDown={(e) => {
                            // Prevent the Input's onBlur from closing the
                            // dropdown before this click is handled.
                            e.preventDefault();
                            selectDestinationSuggestion(s);
                          }}
                          className="w-full text-left"
                          style={{
                            display: "block",
                            padding: "6px 8px",
                            borderRadius: "6px",
                            background: "transparent",
                            border: "none",
                            cursor: "pointer",
                            color: "var(--fg-1)",
                            fontSize: "0.875rem",
                          }}
                        >
                          {s.name}
                          {s.country && (
                            <span style={{ color: "var(--fg-3)" }}> · {s.country}</span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <Input
                label="Country (optional)"
                value={destinationCountry}
                onChange={(e) => {
                  setDestinationCountry(e.target.value);
                  setSelectedDestinationId(null);
                }}
                placeholder="e.g. France"
                className="flex-1 bg-bg-card rounded-xl h-12 px-3.5"
              />
            </div>
            {selectedDestinationId !== null && (
              <p className="text-xs" style={{ color: "var(--fg-3)" }}>
                Using existing destination — shared research will be reused for this trip.
              </p>
            )}
          </div>

          {/* 1. Family Composition */}
          <div className="space-y-3">
            <TripSetupSectionHeader num={2} icon={<Users size={16} />} title="Family Composition" />
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
            <TripSetupSectionHeader num={3} icon={<Heart size={16} />} title="Dietary & Accessibility Needs" />
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
            <TripSetupSectionHeader num={4} icon={<Clock size={16} />} title="Daily Pacing Blocks" />
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
            <TripSetupSectionHeader num={5} icon={<CalendarDays size={16} />} title="Trip Dates" />
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
            <TripSetupSectionHeader num={6} icon={<Building2 size={16} />} title="Pre-Booked Hotel" />
            <p className="text-xs" style={{ color: "var(--fg-3)" }}>Optional — helps us optimize your walking routes.</p>
            <Input
              label="Hotel name"
              value={hotelName}
              onChange={(e) => setHotelName(e.target.value)}
              placeholder="e.g. Grand Hotel"
              className="bg-bg-card rounded-xl h-12 px-3.5"
            />
            <Input
              label="Hotel address"
              value={hotelAddress}
              onChange={(e) => setHotelAddress(e.target.value)}
              placeholder="e.g. 123 Main Street"
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

          {error && (
            <Alert variant="danger">{error}</Alert>
          )}

          {/* In-flow now, not a fixed bottom bar — a real descendant of this
              form, so the type="submit" button triggers onSubmit natively;
              no more form="" + manual document.querySelector("form") relay. */}
          <Button
            type="submit"
            variant="primary"
            size="lg"
            loading={submitting}
            className="w-full rounded-xl"
          >
            {submitting ? "Setting up your trip…" : "Start Planning"}
          </Button>
        </form>
      </div>
      <TripSetupArt
        destinationName={destinationName}
        destinationCountry={destinationCountry}
        hint={
          destinationName.trim()
            ? `Map centers on ${destinationName.trim()} as you fill this in`
            : "Map centers on your destination as you fill this in"
        }
      />
      </div>
      </main>
      </div>
    </>
  );
}
