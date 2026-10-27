import { describe, expect, it } from "vitest";

import { needsCurrentInfo } from "./needs-current-info";

describe("needsCurrentInfo", () => {
  it("is true for legal / current-limit German keywords", () => {
    expect(needsCurrentInfo("Wie hoch ist die Minijob-Grenze?")).toBe(true);
    expect(needsCurrentInfo("Aktuelle Verdienstgrenze 2026")).toBe(true);
    expect(needsCurrentInfo("Was sagt das Gesetz zum Mindestlohn?")).toBe(true);
    expect(needsCurrentInfo("Änderung bei der Sozialversicherung?")).toBe(true);
    expect(needsCurrentInfo("Midijob Paragraph und Recht")).toBe(true);
    expect(needsCurrentInfo("Geringfügige Beschäftigung Grenze")).toBe(true);
  });

  it("is true for expanded current-info phrases", () => {
    expect(needsCurrentInfo("Was gilt derzeit für Minijobs?")).toBe(true);
    expect(needsCurrentInfo("Was gilt heute für den Mindestlohn?")).toBe(true);
    expect(needsCurrentInfo("Was ist momentan die Regelung?")).toBe(true);
    expect(needsCurrentInfo("Gibt es etwas neu bei Minijobs?")).toBe(true);
    expect(needsCurrentInfo("Ist das aktuell gültig?")).toBe(true);
    expect(needsCurrentInfo("Grenze 2026")).toBe(true);
    expect(needsCurrentInfo("Mindestlohn")).toBe(true);
    expect(needsCurrentInfo("Welche Verdienstgrenze gilt?")).toBe(true);
    expect(needsCurrentInfo("Wie hoch ist der Stundenlohn gesetzlich?")).toBe(true);
  });

  it("is false for pure arithmetic without legal-current keywords", () => {
    expect(needsCurrentInfo("Berechne 12 Stunden × 14 Euro")).toBe(false);
    expect(needsCurrentInfo("Summe meiner Stunden diesen Monat")).toBe(false);
    expect(needsCurrentInfo("20 × 13,50 €")).toBe(false);
    expect(needsCurrentInfo("7,5×13,50")).toBe(false);
    expect(needsCurrentInfo("Hochrechnen Wochenstunden")).toBe(false);
  });

  it("is false for user-earnings questions without legal keywords", () => {
    expect(needsCurrentInfo("Wie viel habe ich diesen Monat verdient?")).toBe(false);
    expect(needsCurrentInfo("Was habe ich verdient?")).toBe(false);
  });

  it("is true when arithmetic or earnings mix with legal keywords", () => {
    expect(needsCurrentInfo("Berechne ob ich über der Minijob-Grenze liege")).toBe(true);
    expect(needsCurrentInfo("Summe vs aktuelle Verdienstgrenze")).toBe(true);
    expect(
      needsCurrentInfo("Grenze und wie viel habe ich diesen Monat verdient?"),
    ).toBe(true);
  });

  it("is false for empty / unrelated questions", () => {
    expect(needsCurrentInfo("")).toBe(false);
    expect(needsCurrentInfo("   ")).toBe(false);
    expect(needsCurrentInfo("Wie viele Stunden habe ich gearbeitet?")).toBe(false);
  });

  describe("time words alone do not trigger a web search for the user's own data", () => {
    it.each([
      "Wie viel habe ich diesen Monat verdient?",
      "Wie viel habe ich im Oktober 2026 verdient?",
      "Wie viele Stunden habe ich heute gearbeitet?",
      "Wie hoch ist mein aktueller Verdienst?",
      "Was war mein Verdienst 2025?",
      "Wie viele Schichten hatte ich aktuell diesen Monat?",
      "Wie hoch ist mein Stundenlohn heute?",
      "Zeig mir meine Einträge von 2026",
    ])("false: %s", (q) => {
      expect(needsCurrentInfo(q)).toBe(false);
    });
  });

  describe("legal / current-rate questions still trigger a web search", () => {
    it.each([
      "Wie hoch ist die gesetzliche Minijob-Grenze 2026?",
      "Wie hoch ist der aktuelle Mindestlohn in Deutschland?",
      "Welche gesetzlichen Änderungen gelten 2026 für Minijobs?",
      "Liege ich 2026 über der Minijob-Grenze?",
      "Wie viel Beitrag zur Sozialversicherung zahle ich heute?",
      "Ist das neu 2026?",
      "WIE HOCH IST DIE VERDIENSTGRENZE?",
    ])("true: %s", (q) => {
      expect(needsCurrentInfo(q)).toBe(true);
    });
  });

  it("does not mistake words that merely contain own-data stems for own-data questions", () => {
    // "Stundenlohn" is not "Stunden", "Michael" is not "ich"
    expect(needsCurrentInfo("Wie hoch ist der aktuelle Stundenlohn im Gebäudereiniger-Handwerk?")).toBe(
      true,
    );
    expect(needsCurrentInfo("Was sagt Michael aktuell dazu?")).toBe(true);
  });

  it("treats a year only as a time word when it stands alone", () => {
    expect(needsCurrentInfo("Ereignisse 2026")).toBe(true);
    expect(needsCurrentInfo("Ereignisse 20260")).toBe(false);
  });
});
