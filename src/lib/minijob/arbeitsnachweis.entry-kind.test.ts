/**
 * PDF Spalte 2 = Eintragsart (Shift.kind, Dokumentensprache Deutsch) auf dem
 * LIVE-Pfad: Statistik → „Leistungsnachweis (PDF)“ → exportWorkReportPdf
 * (worklog.ts) und „Arbeitsnachweis (PDF)“ → exportArbeitsnachweisPdf; beide
 * nutzen proofTableHead + buildProofTableRows (arbeitsnachweis.ts).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const saveMock = vi.hoisted(() =>
  vi.fn((opts: { bytes: ArrayBuffer; filename: string; category: string }) => ({
    id: "gen-kind-1",
    name: opts.filename,
    category: opts.category,
    mimeType: "application/pdf",
    size: opts.bytes.byteLength,
    createdAt: new Date().toISOString(),
    dataUrl: "",
    source: "generated" as const,
  })),
);

vi.mock("./generated-docs", async () => {
  const actual = await vi.importActual<typeof import("./generated-docs")>("./generated-docs");
  return { ...actual, saveAndRegisterBytes: saveMock };
});

import {
  buildProofTableRows,
  entryKindCell,
  exportArbeitsnachweisPdf,
  proofTableHead,
} from "./arbeitsnachweis";
import { formatHours, sumHours } from "./calc";
import { DOCUMENT_LOCALE } from "./document-i18n";
import { EMPTY_DATA, replaceAll } from "./store";
import { DEFAULT_SETTINGS, type Job, type Shift, type ShiftKind } from "./types";
import { exportWorkReportPdf } from "./worklog";

const JOB: Job = { id: "j1", name: "Reinigung Kant", color: "#000", mode: "flex", rate: 15 };
const LABELS: Record<ShiftKind, string> = {
  arbeit: "Arbeit",
  urlaub: "Urlaub",
  krank: "Krank",
  feiertag: "Feiertag",
  frei: "Frei",
  sonstige: "Sonstige",
};

function shift(patch: Partial<Shift>): Shift {
  return {
    id: "s",
    kind: "arbeit",
    jobId: "j1",
    date: "2026-09-19",
    start: "06:00",
    end: "06:15",
    breakMinutes: 0,
    ...patch,
  };
}

/** September-Beispiel: Arbeit mit Adresse/Leistungsart + alle Abwesenheitsarten. */
const MONTH: Shift[] = [
  shift({ id: "k", kind: "krank", date: "2026-09-22", start: "09:00", end: "17:00" }),
  shift({
    id: "a2",
    date: "2026-09-19",
    start: "06:15",
    end: "08:00",
    workCode: "UR",
    street: "Kantstraße",
    houseNo: "5",
    zip: "10623",
    city: "Berlin",
    note: "Treppenhaus",
  }),
  shift({
    id: "a1",
    date: "2026-09-19",
    street: "Kantstraße",
    houseNo: "5",
    workplace: "Kantstraße 5",
  }),
  shift({ id: "u", kind: "urlaub", date: "2026-09-21", start: "09:00", end: "17:00" }),
  shift({ id: "f", kind: "feiertag", date: "2026-09-23", start: "09:00", end: "17:00" }),
  shift({ id: "fr", kind: "frei", date: "2026-09-24", start: "09:00", end: "17:00" }),
  shift({ id: "so", kind: "sonstige", date: "2026-09-25", start: "09:00", end: "17:00" }),
];

function lastPdf(): string {
  const call = saveMock.mock.calls.at(-1)?.[0] as { bytes: ArrayBuffer } | undefined;
  expect(call?.bytes).toBeTruthy();
  return Buffer.from(call!.bytes).toString("latin1");
}

beforeEach(() => {
  saveMock.mockClear();
});

describe("Eintragsart-Spalte", () => {
  it.each(Object.entries(LABELS) as [ShiftKind, string][])("%s → %s", (kind, label) => {
    expect(entryKindCell({ kind })).toBe(label);
    expect(buildProofTableRows([shift({ kind })], [JOB])[0]![1]).toBe(label);
  });

  it("bleibt Deutsch, auch wenn die UI-Sprache Englisch ist", () => {
    replaceAll({ ...EMPTY_DATA, settings: { ...DEFAULT_SETTINGS, language: "en" } } as never);
    try {
      expect(entryKindCell({ kind: "urlaub" })).toBe("Urlaub");
      expect(proofTableHead()[1]).toBe("Eintragsart");
    } finally {
      replaceAll({ ...EMPTY_DATA, settings: { ...DEFAULT_SETTINGS, language: "de" } } as never);
    }
  });

  it("Header: Eintragsart statt Einsatzort / Objekt, Rest unverändert", () => {
    expect(proofTableHead()).toEqual([
      "Datum",
      "Eintragsart",
      "Beginn",
      "Ende",
      "Stunden",
      "Leistungsart",
      "Notiz",
    ]);
  });

  it("Beispielzeile: 19.09.2026 | Arbeit | 06:00 | 06:15 | 0,25 h | — | Kantstraße 5", () => {
    const rows = buildProofTableRows(MONTH, [JOB]);
    expect(rows[0]).toEqual([
      "19.09.2026",
      "Arbeit",
      "06:00",
      "06:15",
      "0,25 h",
      "—",
      "Kantstraße 5",
    ]);
  });

  it("Adresse bleibt in der Notiz (Straße+Nr, PLZ+Ort, darunter Notiz), Leistungsart separat", () => {
    const rows = buildProofTableRows(MONTH, [JOB]);
    expect(rows[1]).toEqual([
      "19.09.2026",
      "Arbeit",
      "06:15",
      "08:00",
      "1,75 h",
      "UR",
      "Kantstraße 5\n10623 Berlin\nTreppenhaus",
    ]);
  });

  it("chronologische Reihenfolge unverändert, Abwesenheiten mit ihrer Art", () => {
    const rows = buildProofTableRows(MONTH, [JOB]);
    expect(rows.map((r) => [r[0], r[1], r[2]])).toEqual([
      ["19.09.2026", "Arbeit", "06:00"],
      ["19.09.2026", "Arbeit", "06:15"],
      ["21.09.2026", "Urlaub", "09:00"],
      ["22.09.2026", "Krank", "09:00"],
      ["23.09.2026", "Feiertag", "09:00"],
      ["24.09.2026", "Frei", "09:00"],
      ["25.09.2026", "Sonstige", "09:00"],
    ]);
    // Zeiten/Stunden/Leistungsart der Abwesenheiten wie bisher
    expect(rows[2]!.slice(2, 6)).toEqual(["09:00", "17:00", "8,00 h", "—"]);
  });
});

describe("Live-PDFs", () => {
  const total = formatHours(sumHours(MONTH), DOCUMENT_LOCALE);

  it("Leistungsnachweis (exportWorkReportPdf): Eintragsart-Header, alle Arten, Gesamtstunden unverändert", () => {
    exportWorkReportPdf(MONTH, { jobs: [JOB], month: "September 2026", includePhotos: false });
    const raw = lastPdf();
    expect(raw).toContain("Eintragsart");
    expect(raw).not.toContain("Einsatzort");
    for (const label of Object.values(LABELS)) expect(raw).toContain(`(${label})`);
    expect(raw).toContain("Kantstra");
    expect(raw).toContain("10623 Berlin");
    expect(raw).toContain("(UR)");
    expect(total).toBe("42,00 h");
    expect(raw).toContain(`(${total})`);
  });

  it("Arbeitsnachweis (exportArbeitsnachweisPdf): gleiche Spalte, Gesamtstunden unverändert", () => {
    exportArbeitsnachweisPdf(MONTH, { jobs: [JOB], month: 8, year: 2026, employeeName: "Max" });
    const raw = lastPdf();
    expect(raw).toContain("Eintragsart");
    expect(raw).not.toContain("Einsatzort");
    for (const label of Object.values(LABELS)) expect(raw).toContain(`(${label})`);
    expect(raw).toContain(total);
  });
});
