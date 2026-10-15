/**
 * DECISIONS R3 Punkt 5/7: Jahresbericht (Karte + PDF/XLSX-Zeilen) zeigt bei
 * HB + mehreren gleichzeitig aktiven Minijobs die betroffenen Monate und – bei
 * Job-Filter – die Erklärung, warum der Hinweis trotz Filter bleibt.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AnnualReportCard } from "./AnnualReportCard";
import { tl } from "@/lib/i18n";
import { buildAnnualReport, withAllJobsO4 } from "@/lib/minijob/annual";
import { annualO4Lines } from "@/lib/minijob/annual-export";
import { makeResolver } from "@/lib/minijob/resolve";
import { DEFAULT_SETTINGS, type Job, type Shift } from "@/lib/minijob/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const settings = { ...DEFAULT_SETTINGS, limitAuto: true };
const job = (id: string, employmentType: NonNullable<Job["employmentType"]>): Job => ({
  id,
  name: id,
  color: "#000",
  mode: "flex",
  rate: 20,
  employmentType,
  startDate: "2026-01-01",
});
const shift = (id: string, jobId: string, date: string): Shift => ({
  id,
  jobId,
  kind: "arbeit",
  date,
  start: "08:00",
  end: "12:00",
  breakMinutes: 0,
});
const JOBS = [job("hb", "hauptbeschaeftigung"), job("mj-a", "minijob"), job("mj-b", "minijob")];
// März: beide Minijobs aktiv; September: nur MJ-A.
const SHIFTS = [
  shift("a3", "mj-a", "2026-03-10"),
  shift("b3", "mj-b", "2026-03-11"),
  shift("a9", "mj-a", "2026-09-10"),
];
const resolve = makeResolver(JOBS, settings);

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

describe("withAllJobsO4 (Summen gefiltert, Flag aus allen Daten)", () => {
  it("gefilterter Bericht (nur MJ-A): Summen gefiltert, Flag + Monate aus allen Daten, Erklärung", () => {
    const filtered = SHIFTS.filter((s) => s.jobId === "mj-a");
    const base = buildAnnualReport(filtered, JOBS, settings, 2026, resolve);
    expect(base.multipleMinijobs).toBe(false); // nur MJ-A sichtbar
    const r = withAllJobsO4(base, JOBS, SHIFTS, true);
    expect(r.earnings).toBe(base.earnings);
    expect(r.entries).toBe(2);
    expect(r.multipleMinijobs).toBe(true);
    expect(r.multipleMinijobMonths).toEqual(["2026-03"]);
    expect(r.multipleMinijobsFromAllJobs).toBe(true);
  });

  it("ungefiltert: keine Filter-Erklärung", () => {
    const base = buildAnnualReport(SHIFTS, JOBS, settings, 2026, resolve);
    const r = withAllJobsO4(base, JOBS, SHIFTS, false);
    expect(r.multipleMinijobs).toBe(true);
    expect(r.multipleMinijobsFromAllJobs).toBe(false);
  });

  it("nacheinander aktive Minijobs: kein Hinweis, keine Erklärung", () => {
    const seq = [shift("a3", "mj-a", "2026-03-10"), shift("b9", "mj-b", "2026-09-11")];
    const r = withAllJobsO4(buildAnnualReport(seq, JOBS, settings, 2026, resolve), JOBS, seq, true);
    expect(r.multipleMinijobs).toBe(false);
    expect(r.multipleMinijobMonths).toEqual([]);
    expect(r.multipleMinijobsFromAllJobs).toBe(false);
    expect(annualO4Lines(r)).toEqual([]);
  });
});

describe("annualO4Lines (PDF/XLSX)", () => {
  it("nennt betroffene Monate und die Filter-Erklärung (Dokumentsprache Deutsch)", () => {
    const base = buildAnnualReport(
      SHIFTS.filter((s) => s.jobId === "mj-a"),
      JOBS,
      settings,
      2026,
      resolve,
    );
    const lines = annualO4Lines(withAllJobsO4(base, JOBS, SHIFTS, true));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("März");
    expect(lines[1]).toBe(tl("de", "limit.multipleMinijobsFilterNote"));
  });
});

describe("AnnualReportCard O4-Hinweis", () => {
  function render(filterActive: boolean) {
    const base = buildAnnualReport(
      filterActive ? SHIFTS.filter((s) => s.jobId === "mj-a") : SHIFTS,
      JOBS,
      settings,
      2026,
      resolve,
    );
    const report = withAllJobsO4(base, JOBS, SHIFTS, filterActive);
    act(() => root.render(createElement(AnnualReportCard, { report })));
  }

  it("gefiltert: Monate + Erklärung sichtbar, kein Prozentwert der Grenze", () => {
    render(true);
    expect(container.querySelector('[data-testid="annual-o4-note"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="annual-o4-months"]')?.textContent).toContain(
      "März",
    );
    expect(container.querySelector('[data-testid="annual-o4-filter-note"]')?.textContent).toBe(
      tl("de", "limit.multipleMinijobsFilterNote"),
    );
    expect(container.textContent).not.toMatch(
      new RegExp(`${tl("de", "annual.kpi.limit")}: \\d+ %`),
    );
  });

  it("ungefiltert: Hinweis mit Monaten, ohne Filter-Erklärung", () => {
    render(false);
    expect(container.querySelector('[data-testid="annual-o4-note"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="annual-o4-filter-note"]')).toBeNull();
  });
});
