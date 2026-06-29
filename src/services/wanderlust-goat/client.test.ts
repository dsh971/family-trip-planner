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
    const result = await discoverGoat("Kichijoji", "eat", 1200);

    expect(result.anchor.city).toBe("Kichijoji");
    expect(result.results).toHaveLength(2);
    expect(result.results[0]!.name).toBe("Musashino Supper Club");
    expect(result.results[0]!.score.total).toBe(82);
    expect(result.trace.Region).toBe("JP");
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
    await expect(discoverGoat("Kichijoji", "eat", 1200)).rejects.toThrow(WGCommandError);
  });

  it("malformed JSON from subprocess surfaces as WGCommandError", async () => {
    execMock.mockResolvedValueOnce({ stdout: "not valid json {{{", stderr: "" });

    const { discoverGoat } = await import("./client");
    await expect(discoverGoat("Kichijoji", "eat", 1200)).rejects.toThrow(WGCommandError);
  });

  it("reports WGUnavailableError when binary is not on PATH", async () => {
    whichMock.mockResolvedValueOnce(false);

    const { discoverGoat } = await import("./client");
    await expect(discoverGoat("Kichijoji", "eat", 1200)).rejects.toThrow(WGUnavailableError);
  });

  it("two identical queries hit the cache — execFileAsync called only once", async () => {
    execMock.mockResolvedValue({ stdout: goatFixture, stderr: "" });

    const { discoverGoat } = await import("./client");
    await discoverGoat("Kichijoji", "eat", 1200);
    await discoverGoat("Kichijoji", "eat", 1200);

    expect(execMock).toHaveBeenCalledTimes(1);
  });
});
