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
const resolveConfirmed = () => ({
  job,
  defaultRate: 15,
  sickContinuousConfirmed: ["2026-11", "2026-12"],
});

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

function render(shifts: Shift[], history?: Shift[], r: typeof resolve = resolve) {
  act(() =>
    root.render(
      createElement(ShiftList, {
        shifts,
        ...(history ? { history } : {}),
        jobs: [job],
        resolve: r,
        onSelect: () => {},
      }),
    ),
  );
}
const notices = () =>
  [...container.querySelectorAll<HTMLElement>('[data-testid="shift-pay-notice"]')].map((el) =>
    el.getAttribute("data-notice"),
  );

describe("ShiftList Krankheitsfall-Hinweise", () => {
  it("zeigt sick-legacy-over-limit (Monat nicht bestätigt) mit Text", () => {
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

  it("Plan nur Montag: Mo → Mo ist keine lange Lücke (DECISIONS R3 Punkt 3, keine Fehlwarnung)", () => {
    const monOnly = {
      ...job,
      week: Array.from({ length: 7 }, (_, i) => ({ active: i === 0, ...day })),
    } as Job;
    const shifts = [sick("2026-11-02"), sick("2026-11-09")];
    render(shifts, shifts, () => ({ job: monOnly, defaultRate: 15 }));
    expect(notices()).toEqual([]);
  });

  it("zeigt sick-case-long-gap ohne Plan bei 3 ungewöhnlichen Lückentagen (Di–Do)", () => {
    const noPlan = { ...job, week: undefined } as unknown as Job;
    const work = (date: string) => ({ ...sick(date), id: `w-${date}`, kind: "arbeit" }) as Shift;
    const pattern = [
      "2026-09-15",
      "2026-09-16",
      "2026-09-17",
      "2026-10-19",
      "2026-10-23",
      "2026-10-26",
      "2026-10-30",
    ].map(work);
    const shifts = [sick("2026-11-02"), sick("2026-11-06")];
    render(shifts, [...pattern, ...shifts], () => ({ job: noPlan, defaultRate: 15 }));
    expect(notices()).toEqual(["sick-case-long-gap"]);
    expect(container.textContent).toContain(tl("de", "pay.notice.sick-case-long-gap"));
  });

  it("Monatsgrenze (bestätigt): mit voller Historie ist der Dezember ab Tag 43 überschritten", () => {
    const all = run(new Date(2026, 10, 2), 60);
    const december = all.filter((s) => s.date.startsWith("2026-12"));
    const exceeded = tl("de", "pay.reason.sick-exceeded");
    render(december, all, resolveConfirmed);
    const withHistory = (container.textContent ?? "").split(exceeded).length - 1;
    expect(withHistory).toBe(18);
    render(december, undefined, resolveConfirmed); // nur Monatsliste → Fall wird abgeschnitten
    const without = (container.textContent ?? "").split(exceeded).length - 1;
    expect(without).toBe(0);
  });
});

/**
 * Quelltext genau EINES JSX-Elements (vom öffnenden `<Name` bis zum ersten
 * selbstschließenden `/>`). QA P3-R2-144-a: der frühere Regex lief über das
 * Element hinaus bis in `<ShiftDialog history={shifts}>` (M144-10 überlebte).
 */
function jsxElement(src: string, name: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${name}\\b`, "g");
  for (const m of src.matchAll(re)) {
    const end = src.indexOf("/>", m.index);
    out.push(src.slice(m.index, end + 2));
  }
  return out;
}

describe("Dashboard-Verdrahtung (index.tsx)", () => {
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../../routes/index.tsx"),
    "utf8",
  );
  it("ShiftList bekommt history={shifts} (innerhalb des eigenen Elements)", () => {
    const lists = jsxElement(src, "ShiftList");
    expect(lists).toHaveLength(1);
    expect(lists[0]).toMatch(/\bhistory=\{shifts\}/);
    expect(lists[0]).not.toMatch(/<ShiftDialog/);
  });
  it("ShiftDialog bekommt history={shifts} (innerhalb des eigenen Elements)", () => {
    const dialogs = jsxElement(src, "ShiftDialog");
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0]).toMatch(/\bhistory=\{shifts\}/);
  });
  it("jsxElement erkennt ein fehlendes history im ShiftList-Element (Selbsttest M144-10)", () => {
    const mutated = src.replace(/(<ShiftList\b[\s\S]*?)\s*history=\{shifts\}/, "$1");
    expect(mutated).not.toBe(src);
    expect(jsxElement(mutated, "ShiftList")[0]).not.toMatch(/\bhistory=\{shifts\}/);
  });
  it("MonthCalendar bekommt alle shifts", () => {
    expect(src).toMatch(/<MonthCalendar[\s\S]*?shifts=\{shifts\}/);
  });
});
