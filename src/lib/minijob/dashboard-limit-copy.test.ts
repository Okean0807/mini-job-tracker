/** Dashboard: Monat/Jahr über der regulären Grenze → vorsichtiger Hinweis, kein Verstoß-Urteil. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { tl } from "@/lib/i18n";

const LANGS = ["de", "en", "ru", "tr", "pl"] as const;

describe("Grenzhinweis bei Überschreiten der regulären Grenze", () => {
  it("de: kein kategorisches „ist überschritten“, sondern reguläre Grenze + Prüfhinweis", () => {
    const month = tl("de", "dash.limitMonthOver", { amount: "603,00 €" });
    const year = tl("de", "dash.limitYearOver", { amount: "7.236,00 €" });
    expect(month).toBe(
      "Dein Minijob-Verdienst liegt in diesem Monat über der regulären Monatsgrenze von 603,00 €.",
    );
    expect(year).toBe(
      "Dein Minijob-Verdienst liegt über der regulären Jahresgrenze von 7.236,00 €.",
    );
    for (const text of [month, year]) expect(text).not.toMatch(/ist überschritten/);

    for (const key of ["dash.limitOverExplain", "limit.overExplain"]) {
      const explain = tl("de", key);
      expect(explain).toMatch(/nicht automatisch/);
      expect(explain).toMatch(/regelmäßiges Entgelt in der Jahresbetrachtung/);
      expect(explain).toMatch(/gelegentliches, unvorhersehbares Überschreiten/);
      expect(explain).toMatch(/höchstens 2 Kalendermonate in 12 Monaten/);
      expect(explain).toMatch(/Arbeitgeber oder der Minijob-Zentrale/);
    }
  });

  it("alle Sprachen haben eigene Texte und keine kategorische Verstoß-Formulierung", () => {
    const categorical = [/has been exceeded/i, /превышен\./i, /aşıldı\./i, /ist überschritten/i];
    for (const lang of LANGS) {
      for (const key of [
        "dash.limitMonthOver",
        "dash.limitYearOver",
        "dash.limitOverExplain",
        "limit.overExplain",
      ]) {
        const text = tl(lang, key, { amount: "603,00 €" });
        expect(text, `${lang} ${key}`).not.toBe(key);
        for (const re of categorical) expect(text, `${lang} ${key}`).not.toMatch(re);
      }
      if (lang !== "de") {
        expect(tl(lang, "dash.limitOverExplain")).not.toBe(tl("de", "dash.limitOverExplain"));
      }
    }
  });

  it("Banner zeigt Hinweis + Erklärung + Disclaimer weiterhin zusammen", () => {
    const src = readFileSync(resolve(process.cwd(), "src/routes/index.tsx"), "utf8");
    expect(src).toMatch(
      /dash\.limitMonthOver[\s\S]*?detail=\{t\("dash\.limitOverExplain"\)\}[\s\S]*?disclaimer=\{t\("dash\.limitDisclaimer"\)\}/,
    );
  });
});
