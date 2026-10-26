/** Neue Einstellungen: Standardsatz = Mindestlohn zum Erstellungsdatum; Bestandsdaten bleiben. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { minimumWageFor } from "./legal";
import { newSettingsDefaults, normalize } from "./store";
import { DEFAULT_SETTINGS } from "./types";

describe("newSettingsDefaults", () => {
  it("vor der Mindestlohnänderung 2027: 13,90 €", () => {
    expect(newSettingsDefaults(new Date(2026, 11, 31, 23, 59)).defaultRate).toBe(13.9);
    expect(minimumWageFor("2026-12-31")).toBe(13.9);
  });

  it("ab 01.01.2027: 14,60 € aus der hinterlegten Regelversion", () => {
    expect(newSettingsDefaults(new Date(2027, 0, 1, 0, 1)).defaultRate).toBe(14.6);
    expect(newSettingsDefaults(new Date(2027, 0, 1)).defaultRate).toBe(
      minimumWageFor("2027-01-01"),
    );
  });

  it("ändert sonst nichts an den Standardwerten und mutiert DEFAULT_SETTINGS nicht", () => {
    const fresh = newSettingsDefaults(new Date(2027, 5, 1));
    expect({ ...fresh, defaultRate: DEFAULT_SETTINGS.defaultRate }).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.defaultRate).toBe(13.9);
  });

  it("ohne passende Regelversion bleibt der statische Standardwert", () => {
    expect(newSettingsDefaults(new Date(2010, 0, 1)).defaultRate).toBe(
      DEFAULT_SETTINGS.defaultRate,
    );
  });
});

describe("bestehende Einstellungen werden nicht überschrieben", () => {
  it("normalize behält einen gespeicherten Standardsatz und Job-Sätze – auch nach 2027", () => {
    const stored = normalize({
      settings: { ...DEFAULT_SETTINGS, defaultRate: 12.82 },
      jobs: [{ id: "j", name: "Café", color: "#000", mode: "flex", rate: 12.5 }],
    });
    expect(stored.settings.defaultRate).toBe(12.82);
    expect(stored.jobs[0]!.rate).toBe(12.5);
  });

  it("nur Erststart und leerer Namensraum nutzen newSettingsDefaults", () => {
    const src = readFileSync(resolve(process.cwd(), "src/lib/minijob/store.ts"), "utf8");
    expect(src.match(/newSettingsDefaults\(\)/g)).toHaveLength(2);
    expect(src).toMatch(/\.\.\.DEFAULT_SETTINGS,\s*\.\.\.\(raw\.settings/);
  });
});
