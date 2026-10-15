/**
 * QA P2-144-a: ShiftList zeigt Krankheitsfall-Hinweise und bewertet mit der
 * übergebenen vollen Historie (Monatsgrenze); Dashboard verdrahtet history.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ShiftList } from "./ShiftList";
import { tl } from "@/lib/i18n";
import { isoDate } from "@/lib/minijob/calc";
import type { Job, Shift } from "@/lib/minijob/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const day = { start: "09:00", end: "14:00", breakMinutes: 0 };
const job = {
  id: "j1",
  name: "Job",
  rate: 15,
  color: "#000",
  week: Array.from({ length: 7 }, () => ({ active: true, ...day })),
  startDate: "2025-01-01",
} as unknown as Job;
const sick = (date: string, extra: Partial<Shift> = {}): Shift =>
  ({ id: `k-${date}`, jobId: "j1", kind: "krank", date, ...day, ...extra }) as Shift;
const run = (from: Date, n: number) =>
  Array.from({ length: n }, (_, i) =>
    sick(isoDate(new Date(from.getFullYear(), from.getMonth(), from.getDate() + i))),
  );
const resolve = () => ({ job, defaultRate: 15 });

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(shifts: Shift[], history?: Shift[]) {
  act(() =>
    root.render(
      createElement(ShiftList, {
        shifts,
        ...(history ? { history } : {}),
        jobs: [job],
        resolve,
        onSelect: () => {},
      }),
    ),
  );
}
const notices = () =>
  [...container.querySelectorAll<HTMLElement>('[data-testid="shift-pay-notice"]')].map(
    (el) => el.dataset.notice,
  );

describe("ShiftList Krankheitsfall-Hinweise", () => {
  it("zeigt sick-legacy-over-limit (vor dem Stichtag) mit Text", () => {
    const all = run(new Date(2026, 2, 1), 45); // März/April 2026
    const april = all.filter((s) => s.date.startsWith("2026-04"));
    render(april, all);
    expect(notices()).toContain("sick-legacy-over-limit");
    expect(container.textContent).toContain(tl("de", "pay.notice.sick-legacy-over-limit"));
  });

  it("zeigt sick-case-ambiguous (leerer Arbeitstag zwischen Krankheit)", () => {
    const shifts = [sick("2026-11-02"), sick("2026-11-04")];
    render(shifts);
    expect(notices()).toEqual(["sick-case-ambiguous"]);
    expect(container.textContent).toContain(tl("de", "pay.notice.sick-case-ambiguous"));
  });

  it("ohne Hinweis keine Hinweiszeile", () => {
    render([sick("2026-11-02")]);
    expect(notices()).toEqual([]);
  });

  it("Monatsgrenze: mit voller Historie ist der Dezember ab Tag 43 überschritten", () => {
    const all = run(new Date(2026, 10, 2), 60);
    const december = all.filter((s) => s.date.startsWith("2026-12"));
    const exceeded = tl("de", "pay.reason.sick-exceeded");
    render(december, all);
    const withHistory = (container.textContent ?? "").split(exceeded).length - 1;
    expect(withHistory).toBe(18);
    render(december); // nur Monatsliste → Fall wird abgeschnitten
    const without = (container.textContent ?? "").split(exceeded).length - 1;
    expect(without).toBe(0);
  });
});

describe("Dashboard-Verdrahtung (index.tsx)", () => {
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../../routes/index.tsx"),
    "utf8",
  );
  it("ShiftList bekommt history={shifts}", () => {
    expect(src).toMatch(/<ShiftList[\s\S]*?history=\{shifts\}[\s\S]*?\/>/);
  });
  it("ShiftDialog bekommt history={shifts}", () => {
    expect(src).toMatch(/<ShiftDialog[\s\S]*?history=\{shifts\}[\s\S]*?\/>/);
  });
  it("MonthCalendar bekommt alle shifts", () => {
    expect(src).toMatch(/<MonthCalendar[\s\S]*?shifts=\{shifts\}/);
  });
});
