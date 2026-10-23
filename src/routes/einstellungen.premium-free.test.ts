/**
 * R5b: v1.0 ist vorübergehend kostenlos — keine Premium-Selbstfreischaltung,
 * keine Kauf-/Abo-/Upgrade-Formulierungen im Konto-Bereich.
 * (Quelltext-Prüfung wie einstellungen.batch-f.test.ts; die Seite wird hier nicht gerendert.)
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const root = dirname(fileURLToPath(import.meta.url));
const settingsSrc = readFileSync(join(root, "einstellungen.tsx"), "utf8");
const settingsDict = readFileSync(join(root, "../lib/i18n/dict/settings.ts"), "utf8");

describe("Einstellungen › Konto: kein Premium-Schalter (v1.0 kostenlos)", () => {
  it("renders no premium toggle and never writes settings.premium", () => {
    expect(settingsSrc).not.toMatch(
      /premium\.(settingsTitle|settingsDesc|unlock|active|activated)/,
    );
    expect(settingsSrc).not.toMatch(/updateSettings\(\{\s*premium/);
    expect(settingsSrc).not.toMatch(/settings\.premium/);
  });

  it("settings dictionary has no purchase/subscription wording", () => {
    expect(settingsDict).not.toMatch(/kaufen|Abo\b|Abonnement|Upgrade|€\s*\/\s*Monat|Premium/i);
  });
});
