/**
 * R4 L3/L4: GEO_ENABLED / VOICE_ENABLED build-time switches.
 * Render tests: with both flags off (default) the GPS capture, Nominatim
 * lookup and note-mic entry points are absent and the browser APIs are never
 * touched, even when the browser supports them. Enabled mode is covered too.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const flags = vi.hoisted(() => ({ geo: false, voice: false }));
vi.mock("@/lib/config/features", () => ({
  get GEO_ENABLED() {
    return flags.geo;
  },
  get VOICE_ENABLED() {
    return flags.voice;
  },
}));

import { ShiftDialog } from "./ShiftDialog";
import { DEMO_SCOPE } from "@/lib/minijob/storage-scope";
import {
  activateScope,
  EMPTY_DATA,
  loadFromStorage,
  replaceAll,
  useAppData,
} from "@/lib/minijob/store";
import { DEFAULT_SETTINGS, type Job, type Shift } from "@/lib/minijob/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const here = dirname(fileURLToPath(import.meta.url));

const JOB: Job = { id: "j1", name: "Job", color: "#000", mode: "flex", rate: 15 };
const WORK: Shift = {
  id: "w1",
  jobId: "j1",
  kind: "arbeit",
  date: "2026-03-10",
  start: "09:00",
  end: "12:00",
  breakMinutes: 0,
};
const WORK_WITH_LEGACY_GPS: Shift = { ...WORK, id: "w2", gps: { lat: 52.52, lng: 13.405 } };

let container: HTMLDivElement;
let root: Root;
let getCurrentPosition: ReturnType<typeof vi.fn>;
let watchPosition: ReturnType<typeof vi.fn>;
let speechCtor: ReturnType<typeof vi.fn>;
let fetchSpy: ReturnType<typeof vi.fn>;

function Harness({ shiftId }: { shiftId: string }) {
  const data = useAppData();
  const shift = data.shifts.find((s) => s.id === shiftId) ?? null;
  return createElement(ShiftDialog, {
    open: true,
    onOpenChange: () => {},
    date: shift?.date ?? "2026-03-10",
    shift,
    shiftId,
    jobs: data.jobs,
    customers: data.customers,
    projects: data.projects,
    settings: data.settings,
    objects: data.objects,
  });
}

function seedAndOpen(shift: Shift) {
  act(() => {
    replaceAll({
      ...EMPTY_DATA,
      jobs: [JOB],
      shifts: [shift],
      settings: { ...DEFAULT_SETTINGS, onboarded: true, localDemoMode: true, activeJobId: JOB.id },
    } as never);
  });
  act(() => root.render(createElement(Harness, { shiftId: shift.id })));
  const toggle = document.querySelector<HTMLElement>('[data-testid="entry-more-toggle"]');
  if (toggle && toggle.getAttribute("aria-expanded") !== "true") act(() => toggle.click());
  expect(toggle?.getAttribute("aria-expanded")).toBe("true");
}

const q = (sel: string) => document.querySelector<HTMLElement>(sel);
const micButton = () =>
  Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((b) =>
    b.querySelector("svg.lucide-mic"),
  ) ?? null;

function clearAppKeys() {
  for (let i = window.localStorage.length - 1; i >= 0; i -= 1) {
    const key = window.localStorage.key(i);
    if (key?.startsWith("minijob-")) window.localStorage.removeItem(key);
  }
}

beforeEach(() => {
  clearAppKeys();
  loadFromStorage();
  act(() => activateScope(DEMO_SCOPE));

  // Browser "supports" everything: gating must come from the flags, not from feature detection.
  getCurrentPosition = vi.fn((ok: (p: unknown) => void) =>
    ok({ coords: { latitude: 52.52, longitude: 13.405 } }),
  );
  watchPosition = vi.fn();
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: { getCurrentPosition, watchPosition, clearWatch: vi.fn() },
  });
  speechCtor = vi.fn(function (this: Record<string, unknown>) {
    this["start"] = vi.fn();
    this["stop"] = vi.fn();
  });
  (window as unknown as Record<string, unknown>)["SpeechRecognition"] = speechCtor;
  (window as unknown as Record<string, unknown>)["webkitSpeechRecognition"] = speechCtor;
  fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchSpy);

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  delete (window as unknown as Record<string, unknown>)["SpeechRecognition"];
  delete (window as unknown as Record<string, unknown>)["webkitSpeechRecognition"];
  flags.geo = false;
  flags.voice = false;
});

const nominatimCalls = () =>
  fetchSpy.mock.calls.filter(([u]) => String(u).includes("nominatim.openstreetmap.org")).length;

describe("flags disabled (default)", () => {
  it("renders no GPS controls, no capture button, no note mic; APIs untouched", () => {
    seedAndOpen(WORK);
    expect(q('[data-testid="entry-more-toggle"]')).not.toBeNull();
    expect(q('[data-testid="worklog-geo-controls"]')).toBeNull();
    expect(q('[data-testid="worklog-geo-capture"]')).toBeNull();
    expect(micButton()).toBeNull();
    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(watchPosition).not.toHaveBeenCalled();
    expect(speechCtor).not.toHaveBeenCalled();
    expect(nominatimCalls()).toBe(0);
  });

  it("legacy stored GPS is shown only with a remove button (no capture path)", () => {
    seedAndOpen(WORK_WITH_LEGACY_GPS);
    expect(q('[data-testid="worklog-geo-controls"]')).not.toBeNull();
    expect(q('[data-testid="worklog-geo-capture"]')).toBeNull();
    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(nominatimCalls()).toBe(0);
  });
});

describe("flags enabled", () => {
  it("GEO_ENABLED renders capture; click calls geolocation then Nominatim", async () => {
    flags.geo = true;
    seedAndOpen(WORK);
    const capture = q('[data-testid="worklog-geo-capture"]');
    expect(capture).not.toBeNull();
    await act(async () => {
      capture!.click();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(nominatimCalls()).toBe(1);
  });

  it("VOICE_ENABLED renders the note mic; click constructs SpeechRecognition", async () => {
    flags.voice = true;
    seedAndOpen(WORK);
    const mic = micButton();
    expect(mic).not.toBeNull();
    await act(async () => {
      mic!.click();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(speechCtor).toHaveBeenCalledTimes(1);
  });
});

describe("source wiring (all entry points gated)", () => {
  const dialog = readFileSync(join(here, "ShiftDialog.tsx"), "utf8");
  const assistent = readFileSync(join(here, "../../routes/assistent.tsx"), "utf8");
  const features = readFileSync(join(here, "../../lib/config/features.ts"), "utf8");

  it("flags default to disabled unless env is exactly 'true'", () => {
    expect(features).toMatch(/import\.meta\.env\["VITE_GEO_ENABLED"\] === "true"/);
    expect(features).toMatch(/import\.meta\.env\["VITE_VOICE_ENABLED"\] === "true"/);
  });

  it("ShiftDialog mic, voice(), GPS block and capture are flag-gated", () => {
    expect(dialog).toMatch(/VOICE_ENABLED && voiceSupported\(\)/);
    expect(dialog).toMatch(
      /async function voice\(\) \{\s*\/\/[^\n]*\n\s*if \(!VOICE_ENABLED\) return;/,
    );
    expect(dialog).toMatch(/isWork && \(GEO_ENABLED \|\| gps\)/);
    expect(dialog).toMatch(/\{GEO_ENABLED \? \(\s*<Button/);
    expect(dialog).toMatch(/if \(!GEO_ENABLED\) return;/);
  });

  it("Assistent mic and speak() are flag-gated", () => {
    expect(assistent).toMatch(/VOICE_ENABLED && voiceSupported\(\)/);
    expect(assistent).toMatch(
      /async function speak\(\) \{\s*\/\/[^\n]*\n\s*if \(!VOICE_ENABLED\) return;/,
    );
  });
});
