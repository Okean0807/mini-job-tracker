import { describe, expect, it } from "vitest";

import {
  csvHeaders,
  csvTemplate,
  neutralizeCsvFormula,
  parseCsv,
  shiftsToCsv,
  stripCsvFormulaGuard,
} from "./csv";
import type { Job, Shift } from "./types";

const jobNord: Job = {
  id: "j1",
  name: "Café Nord",
  color: "#abc",
  rate: 13.5,
  mode: "flex",
};

const opts = { jobs: [jobNord], defaultRate: 12 };

describe("parseCsv – Datumsformate", () => {
  it("akzeptiert ISO yyyy-MM-dd", () => {
    const r = parseCsv("2026-03-01;09:00;17:00;30;13,50;Café Nord;", opts);
    expect(r.valid).toHaveLength(1);
    expect(r.valid[0]!.shift!.date).toBe("2026-03-01");
  });

  it("akzeptiert D.M.YYYY und DD.MM.YYYY", () => {
    const r = parseCsv(
      ["1.3.2026;09:00;17:00;0;;Café Nord;", "01.03.2026;09:00;12:00;0;;Café Nord;"].join("\n"),
      opts,
    );
    expect(r.valid).toHaveLength(2);
    expect(r.valid[0]!.shift!.date).toBe("2026-03-01");
    expect(r.valid[1]!.shift!.date).toBe("2026-03-01");
  });

  it("akzeptiert D/M/YYYY und DD/MM/YYYY", () => {
    const r = parseCsv(
      ["2/3/2026;09:00;17:00;0;;Café Nord;", "02/03/2026;18:00;22:00;0;;Café Nord;"].join("\n"),
      opts,
    );
    expect(r.valid).toHaveLength(2);
    expect(r.valid[0]!.shift!.date).toBe("2026-03-02");
    expect(r.valid[1]!.shift!.date).toBe("2026-03-02");
  });

  it("lehnt ungültige Datumsangaben ab", () => {
    // Erste Zeile als Kopf, damit die ungültige Datumszeile im Body landet
    // (eine alleinstehende nicht-datierbare Zeile würde als Header gelten).
    const csv = ["Datum;Beginn;Ende;Pause;Lohn;Job;Notiz", "Montag;09:00;17:00;0;;Café Nord;"].join(
      "\n",
    );
    const r = parseCsv(csv, opts);
    expect(r.valid).toHaveLength(0);
    expect(r.invalid).toHaveLength(1);
    expect(r.invalid[0]!.errors.some((e) => /datum|date/i.test(e))).toBe(true);
  });
});

describe("parseCsv – Zeiten und Zahlen", () => {
  it("akzeptiert Punkt als Zeittrenner und normalisiert", () => {
    const r = parseCsv("2026-03-01;9.05;17.30;0;;Café Nord;", opts);
    expect(r.valid).toHaveLength(1);
    expect(r.valid[0]!.shift!.start).toBe("09:05");
    expect(r.valid[0]!.shift!.end).toBe("17:30");
  });

  it("lehnt ungültige Uhrzeiten ab", () => {
    const badHour = parseCsv("2026-03-01;25:00;17:00;0;;Café Nord;", opts);
    const badMin = parseCsv("2026-03-01;09:99;17:00;0;;Café Nord;", opts);
    expect(badHour.invalid).toHaveLength(1);
    expect(badMin.invalid).toHaveLength(1);
  });

  it("parst Pause und Lohn mit Komma, Leerzeichen und Eurozeichen", () => {
    const r = parseCsv("2026-03-01;09:00;17:00;30; 13,50 €;Café Nord;", opts);
    expect(r.valid).toHaveLength(1);
    expect(r.valid[0]!.shift!.breakMinutes).toBe(30);
    expect(r.valid[0]!.shift!.rate).toBe(13.5);
  });

  it("meldet Fehler bei negativer Pause oder negativem Lohn", () => {
    const br = parseCsv("2026-03-01;09:00;17:00;-5;;Café Nord;", opts);
    const rt = parseCsv("2026-03-01;09:00;17:00;0;-1;Café Nord;", opts);
    expect(br.invalid[0]!.errors.length).toBeGreaterThan(0);
    expect(rt.invalid[0]!.errors.length).toBeGreaterThan(0);
  });
});

describe("parseCsv – Kopfzeile, Trennzeichen, BOM", () => {
  it("überspringt eine nicht-datierbare Kopfzeile und zählt Zeilen ab 2", () => {
    const csv = ["Datum;Beginn;Ende;Pause;Lohn;Job;Notiz", "01.03.2026;09:00;17:00;0;;Café Nord;"].join(
      "\n",
    );
    const r = parseCsv(csv, opts);
    expect(r.valid).toHaveLength(1);
    expect(r.valid[0]!.line).toBe(2);
  });

  it("zählt Zeilen ab 1 ohne Kopfzeile", () => {
    const r = parseCsv("2026-03-01;09:00;17:00;0;;Café Nord;", opts);
    expect(r.valid[0]!.line).toBe(1);
  });

  it("erkennt Komma als Trennzeichen", () => {
    const r = parseCsv("2026-03-01,09:00,17:00,0,13.5,Café Nord,", opts);
    expect(r.valid).toHaveLength(1);
    expect(r.valid[0]!.shift!.rate).toBe(13.5);
    expect(r.valid[0]!.shift!.jobId).toBe("j1");
  });

  it("entfernt UTF-8-BOM", () => {
    const r = parseCsv("\uFEFF2026-03-01;09:00;17:00;0;;Café Nord;", opts);
    expect(r.valid).toHaveLength(1);
    expect(r.valid[0]!.shift!.date).toBe("2026-03-01");
  });

  it("liefert leeres Ergebnis für leeren Text", () => {
    expect(parseCsv("", opts)).toEqual({ rows: [], valid: [], invalid: [], newJobs: [] });
    expect(parseCsv("   \n  ", opts)).toEqual({ rows: [], valid: [], invalid: [], newJobs: [] });
  });
});

describe("parseCsv – Quotes, Jobs, Notizen", () => {
  it("parst quoted Felder mit Semikolon und escaped Anführungszeichen", () => {
    const csv = '2026-03-01;09:00;17:00;0;;Café Nord;"Notiz mit; Semikolon und ""Zitat"""';
    const r = parseCsv(csv, opts);
    expect(r.valid).toHaveLength(1);
    expect(r.valid[0]!.shift!.note).toBe('Notiz mit; Semikolon und "Zitat"');
  });

  it("matched Jobs case-insensitiv und setzt jobId", () => {
    const r = parseCsv("2026-03-01;09:00;17:00;0;;café nord;", opts);
    expect(r.valid[0]!.shift!.jobId).toBe("j1");
    expect(r.newJobs).toEqual([]);
  });

  it("sammelt neue Jobnamen (Schreibweisen separat)", () => {
    const csv = [
      "2026-03-01;09:00;12:00;0;;Neuer Laden;",
      "2026-03-02;09:00;12:00;0;;neuer laden;",
      "2026-03-03;09:00;12:00;0;;Anderer Job;",
    ].join("\n");
    const r = parseCsv(csv, opts);
    expect(r.valid).toHaveLength(3);
    expect(r.newJobs).toEqual(["Neuer Laden", "neuer laden", "Anderer Job"]);
    expect(r.valid.every((row) => row.shift!.jobId === undefined)).toBe(true);
  });

  it("trennt gültige und ungültige Zeilen", () => {
    const csv = [
      "2026-03-01;09:00;17:00;0;;Café Nord;",
      "kaputt;xx;yy;0;;Café Nord;",
      "2026-03-03;10:00;12:00;0;;Café Nord;ok",
    ].join("\n");
    const r = parseCsv(csv, opts);
    expect(r.rows).toHaveLength(3);
    expect(r.valid).toHaveLength(2);
    expect(r.invalid).toHaveLength(1);
    expect(r.valid[1]!.shift!.note).toBe("ok");
  });
});

describe("csvHeaders / csvTemplate", () => {
  it("liefert übersetzte Spaltenüberschriften", () => {
    const h = csvHeaders();
    expect(h).toHaveLength(7);
    expect(h[0]).toBeTruthy();
  });

  it("liefert parsebare Vorlagezeilen", () => {
    const tpl = csvTemplate();
    const r = parseCsv(tpl, { jobs: [], defaultRate: 12 });
    expect(r.valid.length).toBeGreaterThanOrEqual(2);
    expect(r.valid[0]!.shift!.date).toBe("2026-03-01");
    expect(r.valid[1]!.shift!.date).toBe("2026-03-02");
    expect(r.newJobs).toContain("Café Nord");
    expect(r.valid[0]!.shift!.rate).toBe(13.5);
    expect(r.valid[0]!.shift!.note).toBeTruthy();
  });
});

describe("shiftsToCsv – Export und Roundtrip", () => {
  const shift = (over: Partial<Shift> = {}): Shift => ({
    id: "s1",
    kind: "arbeit",
    date: "2026-03-04",
    start: "09:00",
    end: "17:00",
    breakMinutes: 30,
    jobId: "j1",
    rate: 13.5,
    note: 'Pause; "kurz"',
    ...over,
  });

  it("exportiert sortiert und escaped Sonderzeichen", () => {
    const csv = shiftsToCsv(
      [shift({ date: "2026-03-05", id: "b" }), shift({ date: "2026-03-03", id: "a", note: "früh" })],
      [jobNord],
    );
    const lines = csv.split("\n");
    expect(lines[0]).toBe(csvHeaders().join(";"));
    expect(lines[1]!.startsWith("2026-03-03;")).toBe(true);
    expect(lines[2]!.startsWith("2026-03-05;")).toBe(true);
    expect(lines[2]).toContain('"Pause; ""kurz"""');
    expect(lines[2]).toContain("13,5");
    expect(lines[2]).toContain("Café Nord");
  });

  it("roundtript Export → parseCsv (Kernfelder)", () => {
    const exported = shiftsToCsv(
      [
        shift({ date: "2026-03-01", note: "A" }),
        (() => {
          const s = shift({ date: "2026-03-02", breakMinutes: 0 });
          delete s.rate;
          delete s.note;
          return s;
        })(),
      ],
      [jobNord],
    );
    const r = parseCsv(exported, opts);
    expect(r.invalid).toHaveLength(0);
    expect(r.valid).toHaveLength(2);
    expect(r.valid[0]!.shift).toMatchObject({
      date: "2026-03-01",
      start: "09:00",
      end: "17:00",
      breakMinutes: 30,
      rate: 13.5,
      jobId: "j1",
      note: "A",
      kind: "arbeit",
    });
    expect(r.valid[1]!.shift).toMatchObject({
      date: "2026-03-02",
      breakMinutes: 0,
      jobId: "j1",
    });
    expect(r.valid[1]!.shift!.rate).toBeUndefined();
    expect(r.valid[1]!.shift!.note).toBeUndefined();
  });
});

describe("CSV formula injection", () => {
  it("neutralizeCsvFormula prefixes spreadsheet metacharacters", () => {
    expect(neutralizeCsvFormula("=1+1")).toBe("'=1+1");
    expect(neutralizeCsvFormula("+cmd")).toBe("'+cmd");
    expect(neutralizeCsvFormula("-1+1")).toBe("'-1+1");
    expect(neutralizeCsvFormula("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(neutralizeCsvFormula("\tTAB")).toBe("'\tTAB");
    expect(neutralizeCsvFormula("safe note")).toBe("safe note");
    expect(neutralizeCsvFormula("Café Nord")).toBe("Café Nord");
  });

  it("stripCsvFormulaGuard reverses only the protective quote", () => {
    expect(stripCsvFormulaGuard("'=1+1")).toBe("=1+1");
    expect(stripCsvFormulaGuard("'=ok")).toBe("=ok");
    expect(stripCsvFormulaGuard("safe")).toBe("safe");
    expect(stripCsvFormulaGuard("'safe")).toBe("'safe");
  });

  it("shiftsToCsv neutralizes formula-like job names and notes", () => {
    const evilJob: Job = { ...jobNord, id: "j2", name: "=HYPERLINK(\"http://x\")" };
    const s: Shift = {
      id: "s1",
      kind: "arbeit",
      date: "2026-03-04",
      start: "09:00",
      end: "17:00",
      breakMinutes: 0,
      jobId: "j2",
      note: "+payload",
    };
    const csv = shiftsToCsv([s], [evilJob]);
    const line = csv.split("\n")[1]!;
    expect(line).toContain("'=HYPERLINK(");
    expect(line).toContain("'+payload");
    // Structured numeric/date fields must stay untouched (no leading quote on date).
    expect(line.startsWith("2026-03-04;")).toBe(true);
  });

  it("roundtrips formula-like note/job through export → parseCsv", () => {
    const evilJob: Job = { ...jobNord, id: "j2", name: "=1+1" };
    const s: Shift = {
      id: "s1",
      kind: "arbeit",
      date: "2026-03-04",
      start: "09:00",
      end: "12:00",
      breakMinutes: 0,
      jobId: "j2",
      note: "@SUM(A1)",
    };
    const exported = shiftsToCsv([s], [evilJob]);
    expect(exported).toContain("'=1+1");
    expect(exported).toContain("'@SUM(A1)");
    const r = parseCsv(exported, { jobs: [evilJob], defaultRate: 12 });
    expect(r.invalid).toHaveLength(0);
    expect(r.valid).toHaveLength(1);
    expect(r.valid[0]!.jobName).toBe("=1+1");
    expect(r.valid[0]!.shift!.note).toBe("@SUM(A1)");
  });
});
