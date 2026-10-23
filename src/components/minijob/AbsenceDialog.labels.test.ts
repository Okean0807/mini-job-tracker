/**
 * Abwesenheits-Zeitraum gilt für Urlaub, Krank, Frei und Sonstige: die
 * Datumsfelder dürfen nicht "Urlaub von/bis" heißen (Smoke t617u: bei Art
 * "Krank" stand "Urlaub von").
 */
import { describe, expect, it } from "vitest";

import { tl } from "@/lib/i18n";

describe("AbsenceDialog: neutrale Von/Bis-Beschriftung", () => {
  it("de: Von / Bis ohne Bezug auf Urlaub", () => {
    expect(tl("de", "absence.from")).toBe("Von");
    expect(tl("de", "absence.to")).toBe("Bis");
  });
  it("alle Sprachen: keine Abwesenheitsart im Label", () => {
    for (const lang of ["de", "en", "ru", "tr", "pl"] as const) {
      expect(tl(lang, "absence.from")).not.toMatch(/Urlaub|Vacation|Отпуск|İzin|Urlop/i);
      expect(tl(lang, "absence.to")).not.toMatch(/Urlaub|Vacation|Отпуск|İzin|Urlop/i);
    }
  });
});
