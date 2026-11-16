/**
 * B4 – Schnelldauer-Chips: Ende aus Beginn + Dauer, Mitternacht, kein Überschreiben eines selbst
 * gesetzten Endes, Zeitfelder bleiben nutzbar. Rechenkern und Validierung bleiben unverändert.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { shiftHours } from "@/lib/minijob/calc";
import { validateEntry } from "@/lib/minijob/entry-validate";
import { getData } from "@/lib/minijob/store";
import { click, open, q, save, setValue, setup, teardown } from "./entry-test-harness";

beforeEach(() => setup());
afterEach(teardown);

const chip = (h: number) => q<HTMLButtonElement>(`[data-testid="duration-chip-${h}"]`);
const start = () => q<HTMLInputElement>("#von");
const end = () => q<HTMLInputElement>("#bis");

describe("B4 Schnelldauer", () => {
  it.each([
    [2, "11:00"],
    [4, "13:00"],
    [6, "15:00"],
    [8, "17:00"],
    [10, "19:00"],
  ])("%i h ab 09:00 setzt das Ende %s und markiert den Chip", (h, expected) => {
    open(null);
    setValue(start(), "09:00");
    click(chip(h));
    expect(end().value).toBe(expected);
    expect(chip(h).getAttribute("aria-pressed")).toBe("true");
  });

  it("rechnet vom aktuellen Beginn aus", () => {
    open(null);
    setValue(start(), "13:15");
    click(chip(4));
    expect(end().value).toBe("17:15");
  });

  it("über Mitternacht: Ende am Folgetag, Dauer und Pause wie im Rechenkern (einmal abgezogen)", () => {
    open(null);
    setValue(start(), "22:00");
    click(chip(6));
    expect(end().value).toBe("04:00");
    setValue(q<HTMLInputElement>("#pause"), "30");
    save();
    const saved = getData().shifts[0]!;
    expect(saved.date).toBe("2026-09-24");
    expect(saved.start).toBe("22:00");
    expect(saved.end).toBe("04:00");
    expect(shiftHours(saved)).toBe(5.5);
  });

  it("ein selbst gesetztes Ende wird nie überschrieben: Chips gesperrt, Hinweis sichtbar", () => {
    open(null);
    setValue(start(), "09:00");
    setValue(end(), "15:20");
    expect(chip(4).disabled).toBe(true);
    click(chip(4));
    expect(end().value).toBe("15:20");
    expect(q('[data-testid="duration-locked-hint"]').textContent).toBeTruthy();
  });

  it("Ende leeren gibt die Chips wieder frei", () => {
    open(null);
    setValue(start(), "09:00");
    setValue(end(), "15:20");
    setValue(end(), "");
    expect(chip(4).disabled).toBe(false);
    click(chip(4));
    expect(end().value).toBe("13:00");
  });

  it("die Vorgabe 17:00 gilt nicht als selbst gesetzt und darf ersetzt werden", () => {
    open(null);
    click(chip(2));
    expect(end().value).toBe("11:00");
  });

  it("mehrfaches Antippen verschiedener Chips ersetzt nur das Chip-Ende, nie ein Handwert", () => {
    open(null);
    setValue(start(), "08:00");
    click(chip(4));
    click(chip(6));
    expect(end().value).toBe("14:00");
  });

  it("ohne gültigen Beginn sind die Chips gesperrt; eigene Zeiteingabe bleibt möglich", () => {
    open(null);
    setValue(start(), "");
    expect(chip(2).disabled).toBe(true);
    setValue(start(), "07:00");
    setValue(end(), "09:30");
    save();
    expect(getData().shifts[0]!.end).toBe("09:30");
  });

  it("Beginn nachträglich ändern verschiebt das Ende nicht still", () => {
    open(null);
    setValue(start(), "09:00");
    click(chip(4));
    setValue(start(), "10:00");
    expect(end().value).toBe("13:00");
  });

  it("gespeicherter Eintrag mit Chip-Ende: Beginn, Ende, Datum wie angezeigt", () => {
    open(null);
    setValue(start(), "08:00");
    click(chip(8));
    save();
    const saved = getData().shifts[0]!;
    expect([saved.start, saved.end]).toEqual(["08:00", "16:00"]);
  });
});

describe("B4 bestehende Nachtschicht-Validierung bleibt unverändert", () => {
  const base = { kind: "arbeit" as const, date: "2026-09-24", breakMinutes: 0 };

  it("Chip-Nachtschicht (22:00–02:00) ist legitim: nur Hinweis", () => {
    const v = validateEntry({ ...base, start: "22:00", end: "02:00" });
    expect(v.errors).toEqual([]);
    expect(v.warnings).toEqual([]);
    expect(v.infos.map((i) => i.code)).toContain("ends-next-day");
  });

  it("von Hand getipptes Ende weit vor dem Beginn bleibt ein Tippfehler-Verdacht (> 12 h)", () => {
    const v = validateEntry({ ...base, start: "06:00", end: "05:00" });
    expect(v.warnings.map((w) => w.code)).toContain("overnight-long");
  });
});
