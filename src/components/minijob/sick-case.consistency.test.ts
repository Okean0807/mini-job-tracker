/**
 * QA P1: Eintrag nach dem 42. Krankheitstag stand in der Liste als „Bezahlte Abwesenheit · § 3 EntgFG“
 * mit Betrag, fehlte aber im Monatsbetrag. Ursache: ShiftList bekam als Historie nur die Einträge des
 * angezeigten Monats; ein im Vormonat begonnener Fall „begann“ dadurch erst im angezeigten Monat.
 *
 * NICHT geändert (Rechtsregel, Entscheidung beim Owner): 28 Tage Wartezeit, 42 Kalendertage
 * Entgeltfortzahlung je Fall (`sickCaseId`), Zählung ab dem ersten Tag des Falls (Tag 1 = Index 0).
 * Das Test-Gerüst dokumentiert das nur, es legt keine neue Regel fest.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MonthCalendar } from "./MonthCalendar";
import { ShiftList } from "./ShiftList";
import { payrollTotals, shiftPayroll } from "@/lib/minijob/payroll";
import { makeResolver } from "@/lib/minijob/resolve";
import { generateAbsence } from "@/lib/minijob/schedule";
import { DEFAULT_SETTINGS, type FixedDay, type Job, type Shift } from "@/lib/minijob/types";

const day = (active: boolean): FixedDay => ({
  active,
  start: "08:00",
  end: "13:00",
  breakMinutes: 0,
});
// Alle sieben Tage Plan-Tage: jeder Kalendertag des Falls ist ein Eintrag.
const JOB: Job = {
  id: "J",
  name: "Fest",
  color: "#123456",
  rate: 15,
  mode: "fest",
  employmentType: "minijob",
  startDate: "2026-01-01",
  week: [0, 1, 2, 3, 4, 5, 6].map(() => day(true)),
} as Job;

const settings = { ...DEFAULT_SETTINGS, language: "de" as const, bundesland: "BE" };
const resolve = makeResolver([JOB], settings);

// Fall beginnt 10.08.2026 (Tag 1). Kalendertag 42 = 20.09., Kalendertag 43 = 21.09.
const CASE_START = "2026-08-10";
const LAST_PAID = "2026-09-20";
const FIRST_UNPAID = "2026-09-21";
const sick: Shift[] = generateAbsence(JOB, "krank", CASE_START, "2026-10-09", "BE");
const september = sick.filter((s) => s.date.startsWith("2026-09"));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const payroll = (s: Shift) => shiftPayroll(s, { ...resolve(s), history: sick });

describe("Krankheitsfall: Tag 42 / Tag 43", () => {
  it("Kalendertag 42 ist bezahlt, Kalendertag 43 nicht (bestehende Regel, unverändert)", () => {
    const paid = payroll(sick.find((s) => s.date === LAST_PAID)!);
    const unpaid = payroll(sick.find((s) => s.date === FIRST_UNPAID)!);
    expect(paid).toMatchObject({ paid: true, reason: "sick-pay", earnings: 75 });
    expect(unpaid).toMatchObject({ paid: false, reason: "sick-exceeded", earnings: 0 });
  });
});

describe("Liste, Monatsbetrag und Kalender sind zum selben Eintrag einig", () => {
  function renderList(withHistory: boolean) {
    act(() =>
      root.render(
        createElement(ShiftList, {
          shifts: september,
          ...(withHistory ? { history: sick } : {}),
          jobs: [JOB],
          resolve,
          onSelect: () => {},
        }),
      ),
    );
    return [...host.querySelectorAll("li")];
  }
  // formatEuro/formatHours trennen mit geschütztem Leerzeichen.
  const textOf = (li: Element) => (li.textContent ?? "").replace(/\u00a0/g, " ");
  const rowFor = (rows: Element[], dotted: string) =>
    rows.find((li) => textOf(li).startsWith(dotted))!;

  it("Tag 43 steht in der Liste als unbezahlt, nicht als „§ 3 EntgFG“ mit Betrag", () => {
    const rows = renderList(true);
    const text = textOf(rowFor(rows, "21.09.2026"));
    expect(text).toContain("Ohne Entgeltfortzahlung");
    expect(text).not.toContain("Lohnfortzahlung im Krankheitsfall (§ 3 EntgFG)");
    expect(text).toContain("0,00 €");
    expect(textOf(rowFor(rows, "18.09.2026"))).toContain("Bezahlte Abwesenheit");
  });

  it("Summe der Listenbeträge = Monatsbetrag der Payroll", () => {
    const rows = renderList(true);
    const listed = rows.reduce((acc, li) => {
      const m = /(\d+),(\d\d) €\s*[\d,]+ h$/.exec(textOf(li));
      return acc + (m ? Number(m[1]) + Number(m[2]) / 100 : 0);
    }, 0);
    const totals = payrollTotals(september, resolve, sick);
    expect(totals.absenceEarnings).toBe(1500); // 01.–20.09.: 20 bezahlte Kalendertage × 75 €
    expect(listed).toBe(totals.absenceEarnings);
  });

  it("ohne die volle Historie würde die Liste den Tag fälschlich als bezahlt zeigen (Ursache)", () => {
    const rows = renderList(false);
    expect(textOf(rowFor(rows, "21.09.2026"))).toContain("§ 3 EntgFG");
  });

  it("Kalender: Tag 42 zeigt Stunden, Tag 43 keine Stunden und kein „Geplant“", () => {
    act(() =>
      root.render(
        createElement(MonthCalendar, {
          year: 2026,
          month: 8,
          shifts: sick,
          jobs: [JOB],
          bundesland: "BE",
          resolve,
          onChangeMonth: () => {},
          onSelectDay: () => {},
        }),
      ),
    );
    // Jeder September-Tag hat hier einen Eintrag (data-kind), die Zelle für Tag d ist die d-te.
    const cells = [...host.querySelectorAll<HTMLButtonElement>("button[data-kind]")];
    expect(cells).toHaveLength(30);
    const cell = (d: number) => cells[d - 1]!;
    expect(cell(20).textContent).toContain("5,0 h");
    expect(cell(21).textContent).not.toContain("h");
    expect(cell(21).textContent).not.toContain("Geplant");
    expect(cell(21).dataset["kind"]).toBe("krank");
  });

  it("Kalender: ein vorhandener Eintrag überlagert nie das „Geplant“-Etikett", () => {
    // Eintrag ohne Job-Zuordnung an einem Plan-Tag des Jobs: früher erschien „Geplant“ neben dem Eintrag.
    const orphan: Shift = {
      id: "orphan",
      kind: "krank",
      date: "2026-09-21",
      start: "08:00",
      end: "13:00",
      breakMinutes: 0,
    } as Shift;
    act(() =>
      root.render(
        createElement(MonthCalendar, {
          year: 2026,
          month: 8,
          shifts: [orphan],
          jobs: [JOB],
          bundesland: "BE",
          resolve,
          onChangeMonth: () => {},
          onSelectDay: () => {},
        }),
      ),
    );
    const cell = host.querySelector<HTMLButtonElement>('button[data-kind="krank"]')!;
    expect(cell.textContent).toMatch(/^21/);
    expect(cell.textContent).not.toContain("Geplant");
  });
});
