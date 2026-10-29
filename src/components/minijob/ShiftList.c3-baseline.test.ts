/**
 * C3 Etappe 1 – Referenzverhalten der Eintragsliste für Frei / Sonstige OHNE Zusatzfelder (Stand main 926af09):
 * Art, "Ohne Entgeltfortzahlung · Unbezahlte Abwesenheit", 0,00 € und 0,00 h – und KEIN Zeitintervall.
 * Bewusst nicht festgelegt: die Anzeige des Intervalls bei BEZAHLTER Abwesenheit (offener Punkt N1).
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ShiftList } from "./ShiftList";
import { makeResolver } from "@/lib/minijob/resolve";
import { DEFAULT_SETTINGS, type FixedDay, type Job, type Shift } from "@/lib/minijob/types";

const day = (active: boolean): FixedDay => ({
  active,
  start: "08:00",
  end: "12:00",
  breakMinutes: 0,
});
const JOB: Job = {
  id: "F",
  name: "Fest",
  color: "#123456",
  rate: 15,
  mode: "fest",
  employmentType: "minijob",
  startDate: "2025-01-01",
  week: [true, true, true, true, true, false, false].map(day),
} as Job;
const resolve = makeResolver([JOB], { ...DEFAULT_SETTINGS, language: "de", bundesland: "BE" });
const mk = (kind: Shift["kind"], date: string): Shift =>
  ({
    id: date + kind,
    jobId: "F",
    kind,
    date,
    start: "08:00",
    end: "12:00",
    breakMinutes: 0,
  }) as Shift;

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

function rowText(list: Shift[], date: string): string {
  act(() => {
    root.render(
      createElement(ShiftList, {
        shifts: list,
        jobs: [JOB],
        resolve,
        onSelect: () => {},
        history: list,
      }),
    );
  });
  const [y, m, d] = date.split("-");
  const li = [...host.querySelectorAll("li")].find((el) =>
    (el.textContent ?? "").includes(`${d}.${m}.${y}`),
  );
  if (!li) throw new Error(`Zeile ${date} fehlt`);
  return (li.textContent ?? "").replace(/\u00a0/g, " ");
}

describe("ShiftList: Frei / Sonstige ohne Zusatzfelder", () => {
  const list = [mk("frei", "2026-11-04"), mk("sonstige", "2026-11-05")];
  it.each([
    ["2026-11-04", "Frei"],
    ["2026-11-05", "Sonstige"],
  ])("%s (%s): Art, unbezahlt, Grund, 0 € / 0 h, kein Intervall", (date, art) => {
    const text = rowText(list, date);
    expect(text).toContain(art);
    expect(text).toContain("Ohne Entgeltfortzahlung");
    expect(text).toContain("Unbezahlte Abwesenheit");
    expect(text).toContain("0,00 €");
    expect(text).toContain("0,00 h");
    expect(text).not.toContain("08:00");
    expect(text).not.toContain("Ausfallstunden"); // keine bezahlten Abwesenheitsstunden
  });
});
