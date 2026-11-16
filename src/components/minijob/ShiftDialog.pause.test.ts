/**
 * B2 – Pausen-Schnellauswahl: Chips, eigener Wert, ausdrückliche 0, Jobwechsel, keine doppelte
 * Abrechnung. Der Rechenkern bleibt unverändert; geprüft wird nur, was gespeichert wird.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { shiftHours } from "@/lib/minijob/calc";
import { getData } from "@/lib/minijob/store";
import { click, has, open, q, save, setValue, setup, teardown, work } from "./entry-test-harness";

const JOBS = [
  { id: "j1", name: "Reinigung Nord", color: "#0d9488", mode: "flex" as const },
  { id: "j2", name: "Lager Süd", color: "#2563eb", mode: "flex" as const },
];

beforeEach(() => {
  setup({
    jobs: JOBS,
    shifts: [
      work({ id: "a1", date: "2026-09-18", start: "08:00", end: "16:00", breakMinutes: 45 }),
      work({ id: "a2", date: "2026-09-19", start: "08:00", end: "16:00", breakMinutes: 45 }),
      work({ id: "a3", date: "2026-09-20", start: "08:00", end: "16:00", breakMinutes: 20 }),
      work({
        id: "b1",
        date: "2026-09-21",
        start: "08:00",
        end: "16:00",
        breakMinutes: 0,
        jobId: "j2",
      }),
    ],
  });
});
afterEach(teardown);

const pause = () => q<HTMLInputElement>("#pause");
const chip = (m: number) => q<HTMLButtonElement>(`[data-testid="pause-chip-${m}"]`);
const pressed = (m: number) => chip(m).getAttribute("aria-pressed");

function fill() {
  setValue(q<HTMLInputElement>("#von"), "08:00");
  setValue(q<HTMLInputElement>("#bis"), "12:00");
}

describe("B2 Pause-Chips", () => {
  it("zeigt alle fünf Vorgaben und markiert den aktuellen Wert", () => {
    open(null);
    for (const m of [0, 15, 30, 45, 60]) expect(has(`[data-testid="pause-chip-${m}"]`)).toBe(true);
    expect(pause().value).toBe("30");
    expect(pressed(30)).toBe("true");
    expect(pressed(45)).toBe("false");
  });

  it.each([0, 15, 30, 45, 60])("Chip %i setzt die Pause und wird gespeichert", (m) => {
    open(null);
    click(chip(m));
    expect(pause().value).toBe(String(m));
    expect(pressed(m)).toBe("true");
    fill();
    save();
    const saved = getData().shifts.find((s) => !["a1", "a2", "a3", "b1"].includes(s.id))!;
    expect(saved.breakMinutes).toBe(m);
  });

  it("eigener Wert aus dem Zahlenfeld bleibt möglich; kein Chip ist dann markiert", () => {
    open(null);
    setValue(pause(), "20");
    for (const m of [0, 15, 30, 45, 60]) expect(pressed(m)).toBe("false");
    fill();
    save();
    const saved = getData().shifts.find((s) => s.start === "08:00" && s.end === "12:00")!;
    expect(saved.breakMinutes).toBe(20);
  });

  it("ausdrückliche 0 bleibt 0 – auch wenn die Historie 45 vorschlägt", () => {
    open(null);
    click(chip(0));
    fill();
    save();
    const saved = getData().shifts.find((s) => s.start === "08:00" && s.end === "12:00")!;
    expect(saved.breakMinutes).toBe(0);
    expect(shiftHours(saved)).toBe(4);
  });

  it("Vorschlag aus der Historie des gewählten Jobs: markiert, aber nie automatisch gesetzt", () => {
    open(null);
    // j1: zuletzt 20, am häufigsten 45
    expect(chip(45).getAttribute("data-suggested")).toBe("true");
    expect(has('[data-testid="pause-chip-20"]')).toBe(true);
    expect(q('[data-testid="pause-last-hint"]').textContent).toContain("20");
    expect(pause().value).toBe("30");
  });

  it("Jobwechsel ändert eine gewählte Pause nie, nur der Vorschlag wechselt", () => {
    open(null);
    click(chip(15));
    const second = [...document.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Lager Süd"),
    )!;
    click(second);
    expect(pause().value).toBe("15");
    expect(pressed(15)).toBe("true");
    // j2: zuletzt 0 → Hinweis wechselt
    expect(q('[data-testid="pause-last-hint"]').textContent).toContain("0");
    expect(has('[data-testid="pause-chip-20"]')).toBe(false);
  });

  it("Pause wird genau einmal abgezogen: 08–16 Uhr mit 60 Min. = 7 h", () => {
    open(null);
    setValue(q<HTMLInputElement>("#von"), "08:00");
    setValue(q<HTMLInputElement>("#bis"), "16:00");
    click(chip(60));
    save();
    const saved = getData().shifts.find((s) => s.breakMinutes === 60 && s.jobId === "j1")!;
    expect(shiftHours(saved)).toBe(7);
    expect(q('[data-testid="entry-duration"]').textContent).toBeTruthy();
  });
});
