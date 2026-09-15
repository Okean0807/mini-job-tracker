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

  it("is false for pure arithmetic without legal-current keywords", () => {
    expect(needsCurrentInfo("Berechne 12 Stunden × 14 Euro")).toBe(false);
    expect(needsCurrentInfo("Summe meiner Stunden diesen Monat")).toBe(false);
    expect(needsCurrentInfo("20 × 13,50 €")).toBe(false);
    expect(needsCurrentInfo("Hochrechnen Wochenstunden")).toBe(false);
  });

  it("is true when arithmetic mixes with legal keywords", () => {
    expect(needsCurrentInfo("Berechne ob ich über der Minijob-Grenze liege")).toBe(true);
    expect(needsCurrentInfo("Summe vs aktuelle Verdienstgrenze")).toBe(true);
  });

  it("is false for empty / unrelated questions", () => {
    expect(needsCurrentInfo("")).toBe(false);
    expect(needsCurrentInfo("   ")).toBe(false);
    expect(needsCurrentInfo("Wie viele Stunden habe ich gearbeitet?")).toBe(false);
  });
});
