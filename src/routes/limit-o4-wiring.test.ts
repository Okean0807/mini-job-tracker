/**
 * P2-145-a: Verdrahtung des B3-1/O4-Flags in Dashboard, Heute-Karte,
 * Statistik und Jahresbericht (statische Quelltext-Prüfung, kein Render).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), "utf8");

describe("B3-1/O4 wiring", () => {
  const index = read("index.tsx");
  it("Dashboard: Flags für betrachteten Monat/Jahr", () => {
    expect(index).toMatch(/limitReliabilityFlags\(jobs, shifts, year, month\)/);
  });
  it("Dashboard: Monats-/Jahres-LimitCard bekommen ihren eigenen Flag", () => {
    expect(index).toMatch(/usage=\{monthLimit\}[\s\S]*?multipleMinijobs=\{multiMinijobMonth\}/);
    expect(index).toMatch(/usage=\{yearLimit\}[\s\S]*?multipleMinijobs=\{multiMinijobYear\}/);
  });
  it("Dashboard: Prognosekarte bekommt den Prognose-Flag", () => {
    expect(index).toMatch(/<LegalForecastCard[\s\S]*?multipleMinijobs=\{multiMinijob\.forecast\}/);
  });
  it("Dashboard: Banner nutzt Flags je Bereich und effektive Anteile", () => {
    expect(index).toMatch(
      /limitAlertLevel\(appliesMinijobLimit, limitShare, yearShare, multiMinijob\)/,
    );
    expect(index).toMatch(/alertShares\.month >= 100/);
  });
  it("Dashboard: Grenz-Kachel zeigt bei Flag keinen Prozentwert", () => {
    expect(index).toMatch(/appliesMinijobLimit && !multiMinijobMonth \?/);
  });
  it("Dashboard: Heute-Karte bekommt dieselben Flags", () => {
    expect(index).toMatch(/<TodayImportantCard[\s\S]*?limitFlags=\{multiMinijob\}/);
  });
  it("Heute-Karte nutzt die Flags für Alert und Prozent", () => {
    const today = read("../components/minijob/TodayImportantCard.tsx");
    expect(today).toMatch(/limitFlags \?\?/);
    expect(today).toMatch(/monthUsage\.share,\s*yearUsage\.share,\s*multiMinijob,/);
    expect(today).toMatch(/shownShares\.month, shownShares\.year/);
  });
  it("Statistik: Jahreskachel und Jahresbericht nutzen den ungefilterten Flag", () => {
    const stats = read("statistik.tsx");
    expect(stats).toMatch(/multipleMinijobsWithMainJob\(jobs, shifts, yearPeriod\(year\)\)/);
    expect(stats).toMatch(/multipleMinijobs: yearMultiMinijob/);
    expect(stats).toMatch(/yearMultiMinijob \? "—"/);
  });
  it("Jahresbericht-Karte und -Export zeigen bei Flag keinen Prozentwert", () => {
    expect(read("../components/minijob/AnnualReportCard.tsx")).toMatch(/report\.multipleMinijobs/);
    const exp = read("../lib/minijob/annual-export.ts");
    expect(exp.match(/report\.multipleMinijobs/g)?.length).toBe(2);
  });
});
