import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// Load fixtures before mocks
const goatFixture = readFileSync(
  resolve(__dirname, "./fixtures/goat-kichijoji.json"),
  "utf-8"
);
const routeViewFixture = readFileSync(
  resolve(__dirname, "./fixtures/route-view-sample.json"),
  "utf-8"
);
const crossoverFixture = readFileSync(
  resolve(__dirname, "./fixtures/crossover-sample.json"),
  "utf-8"
);

// Mock ./executor (local module — reliable in Vitest)
vi.mock("./executor", () => ({
  execFileAsync: vi.fn(),
}));

// Mock ./which to control binary availability
vi.mock("./which", () => ({
  which: vi.fn().mockResolvedValue(true),
}));

import { execFileAsync } from "./executor";
import { which } from "./which";
import { clearCache } from "./cache";
import { WGUnavailableError, WGCommandError } from "./types";
import { _resetAvailabilityForTesting } from "./client";

const execMock = vi.mocked(execFileAsync);
const whichMock = vi.mocked(which);

describe("U5: Wanderlust GOAT client", () => {
  beforeEach(() => {
    clearCache();
    _resetAvailabilityForTesting();
    vi.clearAllMocks();
    whichMock.mockResolvedValue(true);
  });

  it("discoverGoat returns correctly typed results from goat fixture", async () => {
    execMock.mockResolvedValueOnce({ stdout: goatFixture, stderr: "" });

    const { discoverGoat } = await import("./client");
    const result = await discoverGoat("Kichijoji", "eat", 1200, "Tokyo", "Japan");

    expect(result.anchor.city).toBe("Kichijoji");
    expect(result.results).toHaveLength(2);
    expect(result.results[0]!.name).toBe("Musashino Supper Club");
    expect(result.results[0]!.score.total).toBe(82);
    expect(result.trace.Region).toBe("JP");
  });

  // U2 (plan 2026-08-20-011): buildAnchorName must use the real destination's
  // city/country, not the old Tokyo/Japan default — verified via the anchor
  // positional arg passed to the WG CLI.
  it("discoverGoat builds the anchor from a non-Japan destination's real city/country", async () => {
    execMock.mockResolvedValueOnce({ stdout: goatFixture, stderr: "" });

    const { discoverGoat } = await import("./client");
    await discoverGoat("Le Marais", "eat", 800, "Paris", "France");

    const callArgs = execMock.mock.calls[0]![1] as string[];
    expect(callArgs[1]).toBe("Le Marais, Paris, France");
    expect(callArgs[1]).not.toContain("Tokyo");
    expect(callArgs[1]).not.toContain("Japan");
  });

  it("routeView returns correctly typed results from route-view fixture", async () => {
    execMock.mockResolvedValueOnce({ stdout: routeViewFixture, stderr: "" });

    const { routeView } = await import("./client");
    const result = await routeView("Musashino Supper Club", "Inokashira Park");

    expect(result.distance_meters).toBe(450);
    expect(result.walking_minutes).toBe(6);
    expect(result.along_route).toBeNull();
  });

  it("crossover returns correctly typed results from crossover fixture", async () => {
    execMock.mockResolvedValueOnce({ stdout: crossoverFixture, stderr: "" });

    const { crossover } = await import("./client");
    const result = await crossover("Kichijoji, Tokyo, Japan", 1200, [
      "Musashino Supper Club",
      "Inokashira Park",
    ]);

    expect(result.pair_distance_meters).toBe(450);
    expect(result.pairs).toBeNull();
  });

  it("non-zero exit code surfaces as WGCommandError (not thrown raw)", async () => {
    const err = Object.assign(new Error("subprocess error"), {
      code: 1,
      stderr: "subprocess error",
    });
    execMock.mockRejectedValueOnce(err);

    const { discoverGoat } = await import("./client");
    await expect(discoverGoat("Kichijoji", "eat", 1200, "Tokyo", "Japan")).rejects.toThrow(WGCommandError);
  });

  it("malformed JSON from subprocess surfaces as WGCommandError", async () => {
    execMock.mockResolvedValueOnce({ stdout: "not valid json {{{", stderr: "" });

    const { discoverGoat } = await import("./client");
    await expect(discoverGoat("Kichijoji", "eat", 1200, "Tokyo", "Japan")).rejects.toThrow(WGCommandError);
  });

  it("reports WGUnavailableError when binary is not on PATH", async () => {
    whichMock.mockResolvedValueOnce(false);

    const { discoverGoat } = await import("./client");
    await expect(discoverGoat("Kichijoji", "eat", 1200, "Tokyo", "Japan")).rejects.toThrow(WGUnavailableError);
  });

  it("two identical queries hit the cache — execFileAsync called only once", async () => {
    execMock.mockResolvedValue({ stdout: goatFixture, stderr: "" });

    const { discoverGoat } = await import("./client");
    await discoverGoat("Kichijoji", "eat", 1200, "Tokyo", "Japan");
    await discoverGoat("Kichijoji", "eat", 1200, "Tokyo", "Japan");

    expect(execMock).toHaveBeenCalledTimes(1);
  });

  describe("U1: CLI flag correctness", () => {
    it("happy path eat: uses --minutes, --criteria, --type; drops --radius, --select, --category", async () => {
      execMock.mockResolvedValueOnce({ stdout: goatFixture, stderr: "" });

      const { discoverGoat } = await import("./client");
      await discoverGoat("Kichijoji", "eat", 400, "Tokyo", "Japan");

      const callArgs = execMock.mock.calls[0]![1] as string[];

      const minutesIdx = callArgs.indexOf("--minutes");
      expect(minutesIdx).toBeGreaterThan(-1);
      expect(callArgs[minutesIdx + 1]).toBe("5");

      const criteriaIdx = callArgs.indexOf("--criteria");
      expect(criteriaIdx).toBeGreaterThan(-1);
      expect(callArgs[criteriaIdx + 1]).toBe("family restaurants");

      const typeIdx = callArgs.indexOf("--type");
      expect(typeIdx).toBeGreaterThan(-1);
      expect(callArgs[typeIdx + 1]).toBe("restaurant");

      expect(callArgs).not.toContain("--radius");
      expect(callArgs).not.toContain("--select");
      expect(callArgs).not.toContain("--category");
    });

    it("visit category: uses correct criteria and type", async () => {
      execMock.mockResolvedValueOnce({ stdout: goatFixture, stderr: "" });

      const { discoverGoat } = await import("./client");
      await discoverGoat("Kichijoji", "visit", 400, "Tokyo", "Japan");

      const callArgs = execMock.mock.calls[0]![1] as string[];

      const criteriaIdx = callArgs.indexOf("--criteria");
      expect(criteriaIdx).toBeGreaterThan(-1);
      expect(callArgs[criteriaIdx + 1]).toBe("family activities and attractions");

      const typeIdx = callArgs.indexOf("--type");
      expect(typeIdx).toBeGreaterThan(-1);
      expect(callArgs[typeIdx + 1]).toBe("tourist_attraction");
    });

    it("radius 1200m → 15 minutes", async () => {
      execMock.mockResolvedValueOnce({ stdout: goatFixture, stderr: "" });

      const { discoverGoat } = await import("./client");
      await discoverGoat("Kichijoji", "eat", 1200, "Tokyo", "Japan");

      const callArgs = execMock.mock.calls[0]![1] as string[];

      const minutesIdx = callArgs.indexOf("--minutes");
      expect(minutesIdx).toBeGreaterThan(-1);
      expect(callArgs[minutesIdx + 1]).toBe("15");
    });

    it("radius 100m → clamped to 5 minutes minimum", async () => {
      execMock.mockResolvedValueOnce({ stdout: goatFixture, stderr: "" });

      const { discoverGoat } = await import("./client");
      await discoverGoat("Kichijoji", "eat", 100, "Tokyo", "Japan");

      const callArgs = execMock.mock.calls[0]![1] as string[];

      const minutesIdx = callArgs.indexOf("--minutes");
      expect(minutesIdx).toBeGreaterThan(-1);
      expect(callArgs[minutesIdx + 1]).toBe("5");
    });

    it("cache key uses new flags: same computed walkingMinutes → single executor call", async () => {
      execMock.mockResolvedValue({ stdout: goatFixture, stderr: "" });

      const { discoverGoat } = await import("./client");
      // 400m → round(400/80)=5, 390m → round(390/80)=round(4.875)=5 — same key
      await discoverGoat("Kichijoji", "eat", 400, "Tokyo", "Japan");
      await discoverGoat("Kichijoji", "eat", 390, "Tokyo", "Japan");

      expect(execMock).toHaveBeenCalledTimes(1);
    });
  });

  // U5 (plan 2026-08-20-011): syncCity wrapper around `sync-city`, callable
  // per-destination instead of only at container startup for Tokyo.
  describe("syncCity", () => {
    it("invokes sync-city with the given city/country and non-interactive flags", async () => {
      execMock.mockResolvedValueOnce({ stdout: "", stderr: "" });

      const { syncCity } = await import("./client");
      await syncCity("Paris", "France");

      const callArgs = execMock.mock.calls[0]![1] as string[];
      expect(callArgs[0]).toBe("sync-city");
      expect(callArgs[1]).toBe("Paris");
      const countryIdx = callArgs.indexOf("--country");
      expect(countryIdx).toBeGreaterThan(-1);
      expect(callArgs[countryIdx + 1]).toBe("France");
      expect(callArgs).toContain("--no-input");
      expect(callArgs).toContain("--no-color");
      expect(callArgs).toContain("--yes");
    });

    it("propagates WGUnavailableError when the binary is not on PATH", async () => {
      whichMock.mockResolvedValueOnce(false);

      const { syncCity } = await import("./client");
      await expect(syncCity("Paris", "France")).rejects.toThrow(WGUnavailableError);
    });

    it("propagates WGCommandError on a non-zero exit code", async () => {
      const err = Object.assign(new Error("sync failed"), { code: 1, stderr: "sync failed" });
      execMock.mockRejectedValueOnce(err);

      const { syncCity } = await import("./client");
      await expect(syncCity("Paris", "France")).rejects.toThrow(WGCommandError);
    });

    it("is not cached — two calls invoke the CLI twice", async () => {
      execMock.mockResolvedValue({ stdout: "", stderr: "" });

      const { syncCity } = await import("./client");
      await syncCity("Paris", "France");
      await syncCity("Paris", "France");

      expect(execMock).toHaveBeenCalledTimes(2);
    });
  });

  // Code review fix (2026-08-21, reliability P1): execFileAsync previously
  // had no timeout, so a hang (syncCity is now awaited inside a live SSE
  // request) would leak the orchestrator's run registry entry forever. See
  // runCommand's COMMAND_TIMEOUT_MS comment for the full rationale.
  describe("command timeout", () => {
    it("passes a timeout option to execFileAsync", async () => {
      execMock.mockResolvedValueOnce({ stdout: "", stderr: "" });

      const { syncCity } = await import("./client");
      await syncCity("Paris", "France");

      const options = execMock.mock.calls[0]![2] as { timeout?: number };
      expect(options?.timeout).toBeGreaterThan(0);
    });

    it("surfaces a timed-out call as a WGCommandError rather than hanging", async () => {
      const err = Object.assign(new Error("killed"), { killed: true, signal: "SIGTERM" });
      execMock.mockRejectedValueOnce(err);

      const { syncCity } = await import("./client");
      await expect(syncCity("Paris", "France")).rejects.toThrow(WGCommandError);
    });
  });
});
