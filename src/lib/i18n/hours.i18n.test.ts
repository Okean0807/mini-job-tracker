import { describe, expect, it } from "vitest";

import { LANGUAGES, tl } from "@/lib/i18n";
import type { PayReason } from "@/lib/minijob/payroll";

/**
 * Neue Stundenbeschriftungen und alle Vergütungsgründe der Exporte müssen in allen fünf
 * Sprachen vorhanden und (außer Deutsch) wirklich übersetzt sein – tl() fällt sonst still auf
 * Deutsch zurück.
 */
const HOURS_KEYS = [
  "hours.title",
  "hours.worked",
  "hours.paidAbsence",
  "hours.paidTotal",
  "hours.soll",
  "hours.sollNone",
  "hours.payStatus",
  "stats.card.hoursLabel",
  "stats.card.yearHours",
  "annual.kpi.hours",
  "annual.chart.hours",
  "annual.chart.weekdays",
];
const REASONS: Exclude<PayReason, "worked">[] = [
  "holiday-pay",
  "holiday-off-day",
  "sick-pay",
  "sick-waiting",
  "sick-exceeded",
  "sick-off-day",
  "vacation-pay",
  "unpaid-absence",
];
const KEYS = [...HOURS_KEYS, ...REASONS.map((r) => `pay.reason.${r}`)];
const OTHER = LANGUAGES.map((l) => l.code).filter((c) => c !== "de");

describe("Stunden-/Vergütungsbeschriftungen in allen 5 Sprachen", () => {
  it("es gibt genau fünf Sprachen", () => {
    expect(LANGUAGES.map((l) => l.code)).toEqual(["de", "en", "ru", "tr", "pl"]);
  });

  it.each(KEYS)("%s: nicht leer und kein Schlüssel-Fallback", (key) => {
    for (const { code } of LANGUAGES) {
      const value = tl(code, key);
      expect(value, `${code}:${key}`).toBeTruthy();
      expect(value, `${code}:${key}`).not.toBe(key);
    }
  });

  it.each(KEYS)("%s: nicht-deutsche Sprachen sind übersetzt (kein stiller DE-Fallback)", (key) => {
    const de = tl("de", key);
    for (const code of OTHER) expect(tl(code, key), `${code}:${key}`).not.toBe(de);
  });

  it("die vier Kennzahlen sind je Sprache verschieden benannt", () => {
    for (const { code } of LANGUAGES) {
      const labels = ["hours.worked", "hours.paidAbsence", "hours.paidTotal", "hours.soll"].map(
        (k) => tl(code, k),
      );
      expect(new Set(labels).size, code).toBe(4);
    }
  });
});
