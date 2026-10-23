/**
 * QA P2-144-b: Die Abwesenheits-Vorschau im ShiftDialog bewertet mit der
 * übergebenen Historie (wie die Liste) und zeigt Krankheitsfall-Hinweise.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ShiftDialog } from "./ShiftDialog";
import { tl } from "@/lib/i18n";
import { isoDate } from "@/lib/minijob/calc";
import { withSickConfirmations } from "@/lib/minijob/sick-confirmation";
import { DEMO_SCOPE } from "@/lib/minijob/storage-scope";
import {
  activateScope,
  EMPTY_DATA,
  getData,
  loadFromStorage,
  replaceAll,
  useAppData,
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
const RUN = Array.from({ length: 60 }, (_, i) => sick(isoDate(new Date(2026, 10, 2 + i))));

let container: HTMLDivElement;
let root: Root;

function Harness({ shiftId, withHistory }: { shiftId: string; withHistory: boolean }) {
  const data = useAppData();
  const shift = data.shifts.find((s) => s.id === shiftId) ?? null;
  return createElement(ShiftDialog, {
    open: true,
    onOpenChange: () => {},
    date: shift?.date ?? "2026-11-02",
    shift,
    shiftId,
    jobs: data.jobs,
    customers: data.customers,
    projects: data.projects,
    settings: data.settings,
    objects: data.objects,
    ...(withHistory ? { history: data.shifts } : {}),
  });
}

function seed(shifts: Shift[], confirmed: string[] = []) {
  act(() => {
    replaceAll({
      ...EMPTY_DATA,
      jobs: [JOB],
      shifts,
      settings: {
        ...DEFAULT_SETTINGS,
        onboarded: true,
        localDemoMode: true,
        activeJobId: JOB.id,
        sickContinuousConfirmations: withSickConfirmations(undefined, confirmed, shifts, [JOB]),
      },
    } as never);
  });
}

const open = (shiftId: string, withHistory: boolean) =>
  act(() => root.render(createElement(Harness, { shiftId, withHistory })));
const preview = () => document.querySelector<HTMLElement>('[data-testid="entry-absence-preview"]')!;
const notice = () => document.querySelector<HTMLElement>('[data-testid="entry-absence-notice"]');

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
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("ShiftDialog Krank-Vorschau mit Historie", () => {
  it("Tag 50 eines Falls (Monat bestätigt): mit history → sick-exceeded (wie die Liste)", () => {
    seed(RUN, ["2026-11", "2026-12"]);
    open(RUN[49]!.id, true);
    expect(preview().getAttribute("data-pay-reason")).toBe("sick-exceeded");
  });

  it("Tag 50 NICHT bestätigt → sick-pay + Hinweis (keine automatische Neuberechnung)", () => {
    seed(RUN);
    open(RUN[49]!.id, true);
    expect(preview().getAttribute("data-pay-reason")).toBe("sick-pay");
    expect(notice()?.getAttribute("data-notice")).toBe("sick-legacy-over-limit");
  });

  it("Tag 50 ohne history (Altverhalten der Vorschau) → sick-pay", () => {
    seed(RUN, ["2026-11", "2026-12"]);
    open(RUN[49]!.id, false);
    expect(preview().getAttribute("data-pay-reason")).toBe("sick-pay");
  });

  it("zeigt sick-case-ambiguous in der Vorschau", () => {
    const shifts = [sick("2026-11-02"), sick("2026-11-04")];
    seed(shifts);
    open(shifts[1]!.id, true);
    expect(notice()?.getAttribute("data-notice")).toBe("sick-case-ambiguous");
    expect(notice()?.textContent).toBe(tl("de", "pay.notice.sick-case-ambiguous"));
  });

  it("zeigt sick-legacy-over-limit in der Vorschau", () => {
    const march = Array.from({ length: 45 }, (_, i) => sick(isoDate(new Date(2026, 2, 1 + i))));
    seed(march);
    open(march[44]!.id, true);
    expect(preview().getAttribute("data-pay-reason")).toBe("sick-pay");
    expect(notice()?.getAttribute("data-notice")).toBe("sick-legacy-over-limit");
  });

  it("ohne Hinweis keine Hinweiszeile", () => {
    seed(RUN);
    open(RUN[0]!.id, true);
    expect(notice()).toBeNull();
  });
});

describe("ShiftDialog Speichern: Fallzuordnung und Herkunft (DECISIONS R3 Punkt 1)", () => {
  const stored = (id: string) => getData().shifts.find((s) => s.id === id)!;
  const save = () =>
    act(() => {
      document.querySelector<HTMLButtonElement>('[data-testid="entry-save"]')!.click();
    });
  const linkBox = () =>
    document.querySelector<HTMLInputElement>('[data-testid="entry-sick-link"] input');

  it("Bearbeiten erhält eine bestehende sickCaseId (vorher ging sie verloren)", () => {
    const shifts = [
      { ...sick("2026-11-02"), sickCaseId: "c1" },
      { ...sick("2026-11-03"), sickCaseId: "c1" },
    ];
    seed(shifts);
    open(shifts[1]!.id, true);
    save();
    expect(stored(shifts[1]!.id).sickCaseId).toBe("c1");
  });

  it("Bearbeiten eines bisherigen Krankheitstags macht ihn NICHT zu 'neu erfasst'", () => {
    seed([sick("2026-11-02")]);
    open("k-2026-11-02", true);
    save();
    expect(stored("k-2026-11-02").sickRule).toBeUndefined();
  });

  it("neu erfasster Tag behält sein Merkmal beim Bearbeiten", () => {
    seed([{ ...sick("2026-11-02"), sickRule: "continuous" }]);
    open("k-2026-11-02", true);
    save();
    expect(stored("k-2026-11-02").sickRule).toBe("continuous");
  });

  it("angrenzender expliziter Fall: Standard getrennt, Zuordnung nur per Haken", () => {
    const shifts = [
      { ...sick("2026-11-02"), sickCaseId: "c1" },
      { ...sick("2026-11-03"), sickCaseId: "c1" },
      sick("2026-11-04"),
    ];
    seed(shifts);
    open("k-2026-11-04", true);
    expect(notice()?.getAttribute("data-notice")).toBe("sick-case-ambiguous");
    const label = document.querySelector('[data-testid="entry-sick-link"]');
    expect(label?.getAttribute("data-case-start")).toBe("2026-11-02");
    expect(linkBox()!.checked).toBe(false);
    save();
    expect(stored("k-2026-11-04").sickCaseId).toBeUndefined();

    open("k-2026-11-04", true);
    act(() => linkBox()!.click());
    expect(linkBox()!.checked).toBe(true);
    save();
    expect(stored("k-2026-11-04").sickCaseId).toBe("c1");
  });

  it("unklare Grenze ohne expliziten Fall: nur Hilfetext, keine Zuordnung", () => {
    const shifts = [sick("2026-11-02"), sick("2026-11-04")]; // 03.11. leerer Arbeitstag
    seed(shifts);
    open("k-2026-11-04", true);
    expect(document.querySelector('[data-testid="entry-sick-link"]')).toBeNull();
    expect(document.querySelector('[data-testid="entry-sick-ambiguous-help"]')?.textContent).toBe(
      tl("de", "sick.ambiguousHelp"),
    );
  });

  it("save() setzt das Merkmal über sickRuleForSave(kind, existing)", () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "ShiftDialog.tsx"),
      "utf8",
    );
    expect(src).toMatch(/sickRuleForSave\(kind,\s*existing \?\? undefined\)/);
    expect(src).toMatch(/if \(existing\?\.sickCaseId\) next\.sickCaseId = existing\.sickCaseId;/);
  });
});
