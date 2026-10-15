/**
 * O-2 (DECISIONS R2): Bestätigungs-UI der Neuberechnung. Listet betroffene
 * Monate mit vorher/nachher; ohne Bestätigung keine Datenänderung.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SickRecalcNotice } from "./SickRecalcNotice";
import { tl } from "@/lib/i18n";
import { formatEuro, isoDate } from "@/lib/minijob/calc";
import { payrollTotals, sickRecalcPreview } from "@/lib/minijob/payroll";
import { confirmedSickMonths, withSickConfirmations } from "@/lib/minijob/sick-confirmation";
import { makeResolver } from "@/lib/minijob/resolve";
import { DEMO_SCOPE } from "@/lib/minijob/storage-scope";
import {
  activateScope,
  EMPTY_DATA,
  getData,
  loadFromStorage,
  replaceAll,
  updateSettings,
} from "@/lib/minijob/store";
import { DEFAULT_SETTINGS, type Job, type Shift } from "@/lib/minijob/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const day = { start: "09:00", end: "14:00", breakMinutes: 0 };
const JOB: Job = {
  id: "j1",
  name: "Job",
  color: "#000",
  mode: "fest",
  employmentType: "minijob",
  rate: 15,
  startDate: "2025-01-01",
  week: Array.from({ length: 7 }, () => ({ active: true, ...day })),
};
const sick = (date: string): Shift => ({
  id: `k-${date}`,
  jobId: "j1",
  kind: "krank",
  date,
  ...day,
});
/** 75 Tage ab 02.11.2026 → Dezember 18 + Januar 15 betroffene Tage. */
const RUN = Array.from({ length: 75 }, (_, i) => sick(isoDate(new Date(2026, 10, 2 + i))));
const resolve = makeResolver([JOB], DEFAULT_SETTINGS);

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

const q = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const click = (el: Element | null) => act(() => (el as HTMLElement).click());
function render(shifts: Shift[], onConfirm = vi.fn()) {
  act(() => root.render(createElement(SickRecalcNotice, { shifts, resolve, onConfirm })));
  return onConfirm;
}

describe("SickRecalcNotice", () => {
  it("keine betroffenen Monate → nichts gerendert", () => {
    render(RUN.slice(0, 42));
    expect(q("sick-recalc-notice")).toBeNull();
  });

  it("listet Monate mit vorher/nachher; Prüfen/Abbrechen ändern nichts", () => {
    const snapshot = JSON.stringify(RUN);
    const onConfirm = render(RUN);
    expect(q("sick-recalc-notice")).not.toBeNull();
    expect(container.textContent).toContain(tl("de", "sickRecalc.body", { count: 2 }));
    click(q("sick-recalc-review"));
    const rows = [...container.querySelectorAll("[data-month]")].map((li) =>
      li.getAttribute("data-month"),
    );
    expect(rows).toEqual(["2026-12", "2027-01"]);
    const [dec, jan] = sickRecalcPreview(RUN, resolve);
    expect(dec!.before).toBe(31 * 75);
    expect(dec!.after).toBe(13 * 75);
    const texts = [...container.querySelectorAll('[data-testid="sick-recalc-row"]')].map(
      (el) => el.textContent,
    );
    expect(texts[0]).toBe(
      tl("de", "sickRecalc.row", {
        days: 18,
        before: formatEuro(dec!.before),
        after: formatEuro(dec!.after),
      }),
    );
    expect(texts[1]).toContain(formatEuro(jan!.after));
    click(q("sick-recalc-cancel"));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(JSON.stringify(RUN)).toBe(snapshot);
  });

  it("Bestätigen übergibt nur die ausgewählten Monate", () => {
    const onConfirm = render(RUN);
    click(q("sick-recalc-review"));
    const janBox = container.querySelector('[data-month="2027-01"] input') as HTMLInputElement;
    click(janBox);
    click(q("sick-recalc-confirm"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith(["2026-12"]);
  });

  it("kein Monat ausgewählt → Bestätigen deaktiviert", () => {
    const onConfirm = render(RUN);
    click(q("sick-recalc-review"));
    for (const box of container.querySelectorAll<HTMLInputElement>("[data-month] input")) {
      click(box);
    }
    expect((q("sick-recalc-confirm") as HTMLButtonElement).disabled).toBe(true);
    expect(container.textContent).toContain(tl("de", "sickRecalc.noneSelected"));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("withSickConfirmations: leere Auswahl ändert nichts", () => {
    expect(withSickConfirmations(undefined, [], [], [])).toEqual([]);
  });
});

describe("Ablauf über den Store: erst nach Bestätigung ändern sich Beträge", () => {
  function clearAppKeys() {
    for (let i = window.localStorage.length - 1; i >= 0; i -= 1) {
      const key = window.localStorage.key(i);
      if (key?.startsWith("minijob-")) window.localStorage.removeItem(key);
    }
  }

  it("Dezember 2325 € → nach Bestätigung 975 €; Januar unverändert, Einträge unverändert", () => {
    clearAppKeys();
    loadFromStorage();
    act(() => activateScope(DEMO_SCOPE));
    act(() =>
      replaceAll({
        ...EMPTY_DATA,
        jobs: [JOB],
        shifts: RUN,
        settings: { ...DEFAULT_SETTINGS, onboarded: true, localDemoMode: true },
      } as never),
    );
    const month = (key: string) => {
      const d = getData();
      const r = makeResolver(d.jobs, d.settings);
      return payrollTotals(
        d.shifts.filter((s) => s.date.startsWith(key)),
        r,
        d.shifts,
      ).earnings;
    };
    const shiftsBefore = JSON.stringify(getData().shifts);
    expect(month("2026-12")).toBe(2325);
    const janBefore = month("2027-01");
    // gleicher Aufruf wie im Dashboard (onConfirm)
    act(() =>
      updateSettings({
        sickContinuousConfirmations: withSickConfirmations(
          getData().settings.sickContinuousConfirmations,
          ["2026-12"],
          getData().shifts,
          getData().jobs,
        ),
      }),
    );
    expect(confirmedSickMonths(getData().settings)).toEqual(["2026-12"]);
    expect(month("2026-12")).toBe(975);
    expect(month("2027-01")).toBe(janBefore);
    expect(JSON.stringify(getData().shifts)).toBe(shiftsBefore);
  });
});

describe("Dashboard-Verdrahtung (index.tsx)", () => {
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../../routes/index.tsx"),
    "utf8",
  );
  it("SickRecalcNotice mit allen shifts, Resolver und updateSettings(withSickConfirmations)", () => {
    const el = src.slice(src.indexOf("<SickRecalcNotice"));
    const element = el.slice(0, el.indexOf("/>") + 2);
    expect(element).toMatch(/shifts=\{shifts\}/);
    expect(element).toMatch(/resolve=\{resolve\}/);
    expect(element).toMatch(
      /updateSettings\(\{\s*sickContinuousConfirmations:\s*withSickConfirmations\(\s*settings\.sickContinuousConfirmations,\s*months,\s*shifts,\s*jobs,?\s*\)/,
    );
  });
});
