import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  GpsCaptureUnavailableError,
  isCloudMode,
  isGpsCaptureAvailable,
} from "@/lib/cloud/cloud-mode";

import { applyReverseOrKeep, reverseGeocodeGerman } from "./geo-address";
import { currentPosition } from "./worklog";

// Phase D1 - the two entry points of the GPS / reverse-geocoding mechanism refuse BEFORE touching the
// Geolocation API or the network when the build has no cloud flag (Public Local).
const ROOT = process.cwd();
let geoAccess = 0;
const getCurrentPosition = vi.fn();
let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  geoAccess = 0;
  getCurrentPosition.mockReset();
  Object.defineProperty(globalThis.navigator, "geolocation", {
    configurable: true,
    get() {
      geoAccess += 1; // ANY property access to navigator.geolocation is counted
      return { getCurrentPosition };
    },
  });
  fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchSpy);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("single decision point", () => {
  it('isGpsCaptureAvailable() is exactly isCloudMode(): only the exact string "true" enables it', () => {
    for (const [v, on] of [
      ["true", true],
      ["false", false],
      ["", false],
      ["TRUE", false],
      ["1", false],
      [" true", false],
      ["yes", false],
    ] as [string, boolean][]) {
      vi.stubEnv("VITE_CLOUD_SYNC_ENABLED", v);
      expect(isGpsCaptureAvailable(), v).toBe(on);
      expect(isGpsCaptureAvailable()).toBe(isCloudMode());
    }
    vi.stubEnv("VITE_CLOUD_SYNC_ENABLED", undefined);
    expect(isGpsCaptureAvailable()).toBe(false);
  });
});

describe("Public Local: direct calls are refused before any API is touched", () => {
  beforeEach(() => vi.stubEnv("VITE_CLOUD_SYNC_ENABLED", "false"));

  it("currentPosition() rejects with GpsCaptureUnavailableError and never accesses navigator.geolocation", async () => {
    await expect(currentPosition()).rejects.toBeInstanceOf(GpsCaptureUnavailableError);
    await expect(currentPosition()).rejects.toThrow(/gps-unavailable/);
    expect(geoAccess).toBe(0);
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });
  it("reverseGeocodeGerman() returns null and performs no fetch (injected or global) for valid coordinates", async () => {
    const injected = vi.fn();
    expect(
      await reverseGeocodeGerman(52.52, 13.405, injected as unknown as typeof fetch),
    ).toBeNull();
    expect(await reverseGeocodeGerman(52.52, 13.405)).toBeNull();
    expect(injected).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("the failure contract of reverseGeocodeGerman keeps callers safe: the address stays untouched", async () => {
    const previous = { street: "Altstraße", city: "Köln" };
    expect(applyReverseOrKeep(previous, await reverseGeocodeGerman(50.9, 6.9))).toEqual(previous);
  });
  it("ambiguous flag values behave like OFF (fail closed)", async () => {
    for (const v of ["TRUE", "1", "", " true"]) {
      vi.stubEnv("VITE_CLOUD_SYNC_ENABLED", v);
      await expect(currentPosition()).rejects.toBeInstanceOf(GpsCaptureUnavailableError);
      expect(await reverseGeocodeGerman(1, 1)).toBeNull();
    }
    expect(geoAccess).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("cloud-enabled / d41-pilot: unchanged", () => {
  beforeEach(() => vi.stubEnv("VITE_CLOUD_SYNC_ENABLED", "true"));

  it("currentPosition() asks the Geolocation API (high accuracy, 10 s timeout) and resolves the coordinates", async () => {
    getCurrentPosition.mockImplementation((ok: (p: unknown) => void) =>
      ok({ coords: { latitude: 1.5, longitude: 2.5 } }),
    );
    await expect(currentPosition()).resolves.toEqual({ lat: 1.5, lng: 2.5 });
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(getCurrentPosition.mock.calls[0]?.[2]).toEqual({
      enableHighAccuracy: true,
      timeout: 10000,
    });
  });
  it("currentPosition() still rejects with the browser's own error (e.g. permission denied)", async () => {
    getCurrentPosition.mockImplementation((_ok: unknown, err: (e: unknown) => void) =>
      err({ code: 1 }),
    );
    await expect(currentPosition()).rejects.toEqual({ code: 1 });
  });
  it("reverseGeocodeGerman() performs the original request and maps the result", async () => {
    const injected = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            address: {
              road: "Unter den Linden",
              house_number: "1",
              postcode: "10117",
              city: "Berlin",
            },
          }),
          { status: 200 },
        ),
    );
    const r = await reverseGeocodeGerman(52.517, 13.389, injected as unknown as typeof fetch);
    expect(r).toEqual({ street: "Unter den Linden", houseNo: "1", zip: "10117", city: "Berlin" });
    expect(injected).toHaveBeenCalledTimes(1);
    const calls = injected.mock.calls as unknown as [string, RequestInit][];
    const url = new URL(calls[0]![0]);
    expect(url.origin + url.pathname).toBe("https://nominatim.openstreetmap.org/reverse");
    expect(url.searchParams.get("lat")).toBe("52.517");
    expect(url.searchParams.get("lon")).toBe("13.389");
    expect(url.searchParams.get("format")).toBe("json");
  });
  it("invalid coordinates are still rejected without a request", async () => {
    const injected = vi.fn();
    expect(
      await reverseGeocodeGerman(Number.NaN, 0, injected as unknown as typeof fetch),
    ).toBeNull();
    expect(await reverseGeocodeGerman(91, 0, injected as unknown as typeof fetch)).toBeNull();
    expect(injected).not.toHaveBeenCalled();
  });
});

describe("static inventory: every path to the Geolocation API and to Nominatim is behind the check", () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.(ts|tsx)$/.test(e) && !/\.test\.(ts|tsx)$/.test(e)) out.push(p);
    }
    return out;
  }
  const files = walk(resolve(ROOT, "src"));
  const rel = (p: string) => relative(ROOT, p).replace(/\\/g, "/");
  const code = (f: string) =>
    readFileSync(f, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
  const users = (re: RegExp) =>
    files
      .filter((f) => re.test(code(f)))
      .map(rel)
      .sort();

  it("the Geolocation API (navigator.geolocation / getCurrentPosition / watchPosition) is used only in worklog.ts, after the guard", () => {
    expect(users(/geolocation|getCurrentPosition|watchPosition|clearWatch/)).toEqual([
      "src/lib/minijob/worklog.ts",
    ]);
    const src = code(resolve(ROOT, "src/lib/minijob/worklog.ts"));
    const fn = src.slice(src.indexOf("export async function currentPosition"));
    const guard = fn.indexOf("isGpsCaptureAvailable()");
    expect(guard).toBeGreaterThan(-1);
    for (const needle of ["navigator", "getCurrentPosition", "geolocation"])
      expect(fn.indexOf(needle)).toBeGreaterThan(guard);
    expect(fn.slice(guard, guard + 160)).toMatch(/throw new GpsCaptureUnavailableError/);
  });
  it("the Nominatim request exists only in geo-address.ts, after the guard", () => {
    // (user-facing notice texts in src/lib/i18n name the service; they contain no request code)
    expect(
      users(/nominatim\.openstreetmap\.org/i).filter((f) => !f.startsWith("src/lib/i18n/")),
    ).toEqual(["src/lib/minijob/geo-address.ts"]);
    const src = code(resolve(ROOT, "src/lib/minijob/geo-address.ts"));
    const fn = src.slice(src.indexOf("export async function reverseGeocodeGerman"));
    const guard = fn.indexOf("isGpsCaptureAvailable()");
    expect(guard).toBeGreaterThan(-1);
    for (const needle of ["new URL(NOMINATIM_URL)", "fetchImpl(", "AbortController"])
      expect(fn.indexOf(needle)).toBeGreaterThan(guard);
    expect(fn.slice(guard, guard + 80)).toMatch(/return null/);
  });
  it("the only callers of currentPosition() / reverseGeocodeGerman() are the entry editor (and their own definitions)", () => {
    expect(users(/\bcurrentPosition\s*\(/)).toEqual([
      "src/components/minijob/ShiftDialog.tsx",
      "src/lib/minijob/worklog.ts",
    ]);
    expect(users(/\breverseGeocodeGerman\s*\(/)).toEqual([
      "src/components/minijob/ShiftDialog.tsx",
      "src/lib/minijob/geo-address.ts",
    ]);
  });
  it("the entry editor renders the capture button and the confirmation dialog only when GPS capture is available", () => {
    const src = code(resolve(ROOT, "src/components/minijob/ShiftDialog.tsx"));
    expect(src).toMatch(/const gpsCapture = isGpsCaptureAvailable\(\)/);
    expect(src).toMatch(/\{isWork && \(gpsCapture \|\| gps\) \?/);
    const btn = src.indexOf("await currentPosition()");
    expect(src.lastIndexOf("{gpsCapture ? (", btn)).toBeGreaterThan(
      src.lastIndexOf("worklog-geo-controls", btn),
    );
    expect(src).toMatch(/open=\{gpsCapture && geoPrompt !== null\}/);
    const confirm = src.slice(src.indexOf("async function confirmGeoLookup()"));
    expect(confirm.slice(0, 260)).toMatch(/if \(!pos \|\| !gpsCapture\) return;/);
  });
  it("no other source reads the position through a different API (watch, permissions, IP lookups)", () => {
    expect(users(/navigator\.permissions|ipapi|ipinfo|ip-api|geoip|ipify/i)).toEqual([]);
  });
});
