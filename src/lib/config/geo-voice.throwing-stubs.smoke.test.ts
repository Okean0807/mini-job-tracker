/**
 * R6 proposed smoke: with VITE_GEO_ENABLED / VITE_VOICE_ENABLED unset (real
 * features module, no mock) the user flows ShiftDialog (incl. "more" section and
 * note field) and the Assistent page never touch geolocation, SpeechRecognition
 * or Nominatim. All stubs THROW and record every invocation.
 */
import { act, createElement, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({ options }),
  Link: ({ children }: { children?: unknown }) => children,
}));
vi.mock("@tanstack/react-start", () => ({
  useServerFn: () => async () => ({ answer: "ok" }),
  createServerFn: () => {
    const chain = {
      middleware: () => chain,
      inputValidator: () => chain,
      handler: () => async () => ({ answer: "ok" }),
    };
    return chain;
  },
  createMiddleware: () => ({ server: () => ({}) }),
}));
vi.mock("@/lib/ai.functions", () => ({ askAssistant: async () => ({ answer: "ok" }) }));
vi.mock("@/hooks/use-auth-session", () => ({
  useAuthSession: () => ({ status: "signed_in", session: { user: { id: "u-smoke" } } }),
}));

import { GEO_ENABLED, VOICE_ENABLED } from "./features";
import { ShiftDialog } from "@/components/minijob/ShiftDialog";
import { DEMO_SCOPE } from "@/lib/minijob/storage-scope";
import {
  activateScope,
  EMPTY_DATA,
  loadFromStorage,
  replaceAll,
  useAppData,
} from "@/lib/minijob/store";
import { DEFAULT_SETTINGS, type Job, type Shift } from "@/lib/minijob/types";
import { Route as AssistentRoute } from "@/routes/assistent";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

const invoked: string[] = [];
const thrower = (name: string) =>
  function () {
    invoked.push(name);
    throw new Error(`forbidden browser API invoked: ${name}`);
  };

let container: HTMLDivElement;
let root: Root;

function Harness() {
  const data = useAppData();
  const shift = data.shifts.find((s) => s.id === WORK.id) ?? null;
  return createElement(ShiftDialog, {
    open: true,
    onOpenChange: () => {},
    date: WORK.date,
    shift,
    shiftId: WORK.id,
    jobs: data.jobs,
    customers: data.customers,
    projects: data.projects,
    settings: data.settings,
    objects: data.objects,
  });
}

function typeInto(el: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  act(() => {
    el.focus();
    setter?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  invoked.length = 0;
  for (let i = window.localStorage.length - 1; i >= 0; i -= 1) {
    const key = window.localStorage.key(i);
    if (key?.startsWith("minijob-")) window.localStorage.removeItem(key);
  }
  loadFromStorage();
  act(() => activateScope(DEMO_SCOPE));
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: {
      getCurrentPosition: thrower("geolocation.getCurrentPosition"),
      watchPosition: thrower("geolocation.watchPosition"),
      clearWatch: thrower("geolocation.clearWatch"),
    },
  });
  const w = window as unknown as Record<string, unknown>;
  w["SpeechRecognition"] = thrower("SpeechRecognition");
  w["webkitSpeechRecognition"] = thrower("webkitSpeechRecognition");
  const realFetch = globalThis.fetch;
  vi.stubGlobal("fetch", (input: unknown, init?: unknown) => {
    if (String(input).includes("nominatim")) return thrower("fetch(nominatim)")();
    return realFetch
      ? realFetch(input as never, init as never)
      : Promise.reject(new Error("no fetch"));
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  const w = window as unknown as Record<string, unknown>;
  delete w["SpeechRecognition"];
  delete w["webkitSpeechRecognition"];
});

describe("flags unset: throwing stubs are never invoked", () => {
  it("real build-time flags are false in this run", () => {
    expect(GEO_ENABLED).toBe(false);
    expect(VOICE_ENABLED).toBe(false);
  });

  it("ShiftDialog: open, expand 'more', type into the note field", () => {
    act(() => {
      replaceAll({
        ...EMPTY_DATA,
        jobs: [JOB],
        shifts: [WORK],
        settings: {
          ...DEFAULT_SETTINGS,
          onboarded: true,
          localDemoMode: true,
          activeJobId: JOB.id,
        },
      } as never);
    });
    act(() => root.render(createElement(Harness)));
    const toggle = document.querySelector<HTMLElement>('[data-testid="entry-more-toggle"]');
    expect(toggle).not.toBeNull();
    if (toggle?.getAttribute("aria-expanded") !== "true") act(() => toggle!.click());
    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
    const note = document.querySelector<HTMLTextAreaElement>("textarea#notiz");
    expect(note).not.toBeNull();
    typeInto(note!, "Smoke-Notiz");
    expect(note!.value).toBe("Smoke-Notiz");
    expect(document.querySelector('[data-testid="worklog-geo-capture"]')).toBeNull();
    expect(document.querySelector("svg.lucide-mic")).toBeNull();
    expect(invoked).toEqual([]);
  });

  it("Assistent page (signed in): renders input, no mic, typing works", () => {
    const Page = (AssistentRoute as unknown as { options: { component: ComponentType } }).options
      .component;
    act(() => root.render(createElement(Page)));
    const ta = container.querySelector<HTMLTextAreaElement>("textarea");
    expect(ta).not.toBeNull();
    typeInto(ta!, "Wie viele Stunden?");
    expect(container.querySelector("svg.lucide-mic")).toBeNull();
    expect(invoked).toEqual([]);
  });
});
