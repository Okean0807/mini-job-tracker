/**
 * Phase D1 - GPS / Nominatim privacy. REAL render tests of the entry editor (react-dom/client + act, happy-dom,
 * real store) with an instrumented Geolocation API and an instrumented fetch.
 * Public Local = baked cloud flag OFF; cloud-enabled / d41-pilot = flag ON (both bake "true").
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ShiftDialog } from "./ShiftDialog";
import { DEMO_SCOPE } from "@/lib/minijob/storage-scope";
import {
  activateScope,
  EMPTY_DATA,
  getData,
  loadFromStorage,
  replaceAll,
  useAppData,
} from "@/lib/minijob/store";
import { DEFAULT_SETTINGS, type Shift } from "@/lib/minijob/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DAY = "2026-09-24";
const GPS = { lat: 52.52, lng: 13.405 };
const geo = { getCurrentPosition: vi.fn() };
let fetchSpy: ReturnType<typeof vi.fn>;
let container: HTMLDivElement;
let root: Root;

const withAddress: Shift = {
  id: "s-addr",
  kind: "arbeit",
  date: DAY,
  start: "08:00",
  end: "12:00",
  breakMinutes: 0,
  jobId: "j1",
  createdAt: "2026-09-20",
  street: "Musterstraße",
  houseNo: "15",
  zip: "10115",
  city: "Berlin",
  floor: "3",
  doorSide: "links",
  gps: GPS,
};
const noGps: Shift = { ...withAddress, id: "s-nogps", date: "2026-09-25" };
delete (noGps as { gps?: unknown }).gps;

function Harness({ shiftId, date = DAY }: { shiftId: string | null; date?: string }) {
  const data = useAppData();
  const shift = shiftId ? (data.shifts.find((s) => s.id === shiftId) ?? null) : null;
  return createElement(ShiftDialog, {
    open: true,
    onOpenChange: () => {},
    date,
    shift,
    shiftId,
    jobs: data.jobs,
    customers: data.customers,
    projects: data.projects,
    settings: data.settings,
    objects: data.objects,
  });
}
const q = <T extends Element = HTMLElement>(sel: string): T | null =>
  document.querySelector<T>(sel);
const need = <T extends Element = HTMLElement>(sel: string): T => {
  const el = q<T>(sel);
  if (!el) throw new Error("not found: " + sel);
  return el;
};
const click = (el: Element) =>
  act(() => {
    (el as HTMLElement).click();
  });
function setValue(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function openEditor(id: string | null, date?: string) {
  act(() => {
    root.render(createElement(Harness, { shiftId: id, ...(date ? { date } : {}) }));
  });
}
/** Opens "more details" and the address block so the GPS controls and the manual fields are reachable. */
function expandAll() {
  const more = need('[data-testid="entry-more-toggle"]');
  if (more.getAttribute("aria-expanded") !== "true") click(more);
  const addr = q('[data-testid="object-address-toggle"]');
  if (addr && addr.getAttribute("aria-expanded") !== "true") click(addr);
}
const save = () => click(need('[data-testid="entry-save"]'));
const shiftOf = (id: string) => getData().shifts.find((s) => s.id === id)!;
const nominatimCalls = () =>
  fetchSpy.mock.calls.filter(([u]) => /nominatim|openstreetmap/i.test(String(u)));

beforeEach(() => {
  for (let i = window.localStorage.length - 1; i >= 0; i -= 1) {
    const k = window.localStorage.key(i);
    if (k?.startsWith("minijob-")) window.localStorage.removeItem(k);
  }
  loadFromStorage();
  act(() => {
    activateScope(DEMO_SCOPE);
    replaceAll({
      ...EMPTY_DATA,
      jobs: [{ id: "j1", name: "Reinigung Nord", color: "#0d9488", mode: "flex" }],
      shifts: [withAddress, noGps],
      settings: { ...DEFAULT_SETTINGS, onboarded: true, localDemoMode: true },
    } as never);
  });
  geo.getCurrentPosition.mockReset();
  Object.defineProperty(globalThis.navigator, "geolocation", { value: geo, configurable: true });
  fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchSpy);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Public Local (cloud flag OFF): no GPS capture", () => {
  beforeEach(() => vi.stubEnv("VITE_CLOUD_SYNC_ENABLED", "false"));

  it("the capture button and the confirmation dialog do not exist (new entry and existing entry without GPS)", () => {
    for (const [id, date] of [
      [null, DAY],
      ["s-nogps", "2026-09-25"],
    ] as [string | null, string][]) {
      openEditor(id, date);
      expandAll();
      expect(q('[data-testid="worklog-geo-controls"]'), String(id)).toBeNull();
      expect(document.body.textContent).not.toMatch(/Standort erfassen|Capture location/);
      expect(q('[data-testid="geo-notice-dialog"]')).toBeNull();
      expect(document.body.textContent).not.toMatch(/Nominatim|Adresse aus Standort/);
    }
  });
  it("opening, expanding, editing and saving the form never touches the Geolocation API or the network", () => {
    openEditor("s-nogps", "2026-09-25");
    expandAll();
    setValue(need<HTMLInputElement>("#strasse"), "Neue Straße");
    save();
    expect(geo.getCurrentPosition).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("manual address entry works: edit every field, save, reopen -> values kept (same field format)", () => {
    openEditor("s-nogps", "2026-09-25");
    expandAll();
    for (const [sel, v] of [
      ["#strasse", "Beispielweg"],
      ["#hausnr", "7a"],
      ["#plz", "20095"],
      ["#ort", "Hamburg"],
      ["#etage", "2"],
    ] as const)
      setValue(need<HTMLInputElement>(sel), v);
    save();
    const s = shiftOf("s-nogps");
    expect(s).toMatchObject({
      street: "Beispielweg",
      houseNo: "7a",
      zip: "20095",
      city: "Hamburg",
      floor: "2",
      doorSide: "links",
    });
    expect(s.gps).toBeUndefined();
    act(() => root.render(createElement("div")));
    openEditor("s-nogps", "2026-09-25");
    expandAll();
    expect(need<HTMLInputElement>("#strasse").value).toBe("Beispielweg");
    expect(need<HTMLInputElement>("#ort").value).toBe("Hamburg");
  });
  it("an existing entry with address AND gps: saving without touching anything keeps gps and every address field unchanged", () => {
    const before = JSON.stringify(shiftOf("s-addr"));
    openEditor("s-addr");
    save();
    const after = shiftOf("s-addr");
    expect(after.gps).toEqual(GPS);
    expect(after).toMatchObject({
      street: "Musterstraße",
      houseNo: "15",
      zip: "10115",
      city: "Berlin",
      floor: "3",
      doorSide: "links",
    });
    const b = JSON.parse(before) as Record<string, unknown>;
    const changed = Object.keys({ ...b, ...after }).filter(
      (k) => JSON.stringify((after as never)[k]) !== JSON.stringify(b[k]),
    );
    // Saving links the entry to its work object (store behaviour that exists independently of GPS): objectId may be
    // added, nothing else - in particular gps and every address field stay exactly as they were.
    expect(changed.filter((k) => k !== "objectId")).toEqual([]);
  });
  it("editing other fields (address, hours) keeps the old coordinates untouched", () => {
    openEditor("s-addr");
    expandAll();
    setValue(need<HTMLInputElement>("#strasse"), "Geänderte Straße");
    setValue(need<HTMLInputElement>("#bis"), "13:00");
    save();
    expect(shiftOf("s-addr").gps).toEqual(GPS);
    expect(shiftOf("s-addr").street).toBe("Geänderte Straße");
    expect(shiftOf("s-addr").end).toBe("13:00");
  });
  it("old coordinates are shown read-only (text, no capture button) and can be removed; the address stays", () => {
    openEditor("s-addr");
    expandAll();
    const box = need('[data-testid="worklog-geo-controls"]');
    expect(box.textContent).toContain("52.52000, 13.40500");
    expect(box.querySelectorAll("input").length).toBe(0);
    expect(box.textContent).not.toMatch(/Standort erfassen|Capture location/);
    const remove = need("[data-testid=worklog-geo-controls] button");
    click(remove);
    // in Public Local the whole block disappears once nothing is left to show
    expect(q('[data-testid="worklog-geo-controls"]')).toBeNull();
    expect(document.body.textContent).not.toContain("52.52000");
  });
  it("after removing the coordinates and saving, only gps is gone; reopening does not bring it back; geolocation untouched", () => {
    openEditor("s-addr");
    expandAll();
    click(need("[data-testid=worklog-geo-controls] button"));
    save();
    const s = shiftOf("s-addr");
    expect(s.gps).toBeUndefined();
    expect(s).toMatchObject({
      street: "Musterstraße",
      houseNo: "15",
      zip: "10115",
      city: "Berlin",
      floor: "3",
      doorSide: "links",
    });
    act(() => root.render(createElement("div")));
    openEditor("s-addr");
    expandAll();
    expect(q('[data-testid="worklog-geo-controls"]')).toBeNull();
    expect(geo.getCurrentPosition).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("cloud-enabled / d41-pilot (cloud flag ON): behaviour unchanged", () => {
  beforeEach(() => vi.stubEnv("VITE_CLOUD_SYNC_ENABLED", "true"));

  it("the capture button is present for new entries and entries without GPS", () => {
    openEditor("s-nogps", "2026-09-25");
    expandAll();
    expect(need('[data-testid="worklog-geo-controls"]').textContent).toMatch(
      /Standort erfassen|Capture location/,
    );
  });
  it("click -> Geolocation API is called once -> confirmation dialog; declining sends nothing", async () => {
    geo.getCurrentPosition.mockImplementation((ok: (p: unknown) => void) =>
      ok({ coords: { latitude: 52.5, longitude: 13.4 } }),
    );
    openEditor("s-nogps", "2026-09-25");
    expandAll();
    const btn = need("[data-testid=worklog-geo-controls] button");
    await act(async () => {
      btn.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(geo.getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(q('[data-testid="geo-notice-dialog"]')).not.toBeNull();
    expect(nominatimCalls()).toHaveLength(0);
    const decline = [...document.querySelectorAll('[data-testid="geo-notice-dialog"] button')].find(
      (b) => /Nur Standort|Save location only/.test(b.textContent ?? ""),
    )!;
    click(decline);
    expect(nominatimCalls()).toHaveLength(0);
  });
  it("confirming sends exactly one Nominatim request and fills the address fields from the result", async () => {
    geo.getCurrentPosition.mockImplementation((ok: (p: unknown) => void) =>
      ok({ coords: { latitude: 52.517, longitude: 13.389 } }),
    );
    fetchSpy.mockImplementation(
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
    openEditor("s-nogps", "2026-09-25");
    expandAll();
    await act(async () => {
      need("[data-testid=worklog-geo-controls] button").click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const confirm = [...document.querySelectorAll('[data-testid="geo-notice-dialog"] button')].find(
      (b) => /Adresse ermitteln|Look up address/.test(b.textContent ?? ""),
    )!;
    await act(async () => {
      (confirm as HTMLElement).click();
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(nominatimCalls()).toHaveLength(1);
    expect(String(nominatimCalls()[0]![0])).toMatch(
      /^https:\/\/nominatim\.openstreetmap\.org\/reverse\?.*lat=52\.517.*lon=13\.389/,
    );
    expect(need<HTMLInputElement>("#strasse").value).toBe("Unter den Linden");
    expect(need<HTMLInputElement>("#ort").value).toBe("Berlin");
  });
  it("existing coordinates keep the remove button next to the capture button", () => {
    openEditor("s-addr");
    expandAll();
    const t = need('[data-testid="worklog-geo-controls"]');
    expect(t.textContent).toMatch(/Standort erfassen|Capture location/);
    expect(t.querySelectorAll("button").length).toBe(2);
  });
});
