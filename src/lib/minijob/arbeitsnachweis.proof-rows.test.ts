import { beforeEach, describe, expect, it, vi } from "vitest";

const saveMock = vi.hoisted(() =>
  vi.fn((opts: { bytes: ArrayBuffer; filename: string; category: string }) => ({
    id: "gen-proof-1",
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
  return {
    ...actual,
    saveAndRegisterBytes: saveMock,
  };
});

import {
  buildProofTableRows,
  exportArbeitsnachweisPdf,
  filledAtLabel,
  proofKindSummary,
  proofTableHead,
} from "./arbeitsnachweis";
import { exportWorkReportPdf } from "./worklog";
import type { Job, Shift } from "./types";

function makeJob(patch: Partial<Job> = {}): Job {
  return {
    id: "j1",
    name: "Reinigung",
    color: "#000",
    mode: "flex",
    rate: 15,
    ...patch,
  } as Job;
}

function makeShift(patch: Partial<Shift> = {}): Shift {
  return {
    id: "s1",
    kind: "arbeit",
    jobId: "j1",
    date: "2026-09-20",
    start: "06:00",
    end: "07:00",
    breakMinutes: 0,
    rate: 15,
    ...patch,
  };
}

/** Decode PDF bytes without pdftotext (CI has no poppler-utils). */
function pdfLatin1FromLastSave(): string {
  const call = saveMock.mock.calls.at(-1)?.[0] as { bytes: ArrayBuffer } | undefined;
  expect(call?.bytes).toBeTruthy();
  expect(call!.bytes.byteLength).toBeGreaterThan(100);
  const latin1 = Buffer.from(call!.bytes).toString("latin1");
  expect(latin1.startsWith("%PDF")).toBe(true);
  return latin1;
}

beforeEach(() => {
  saveMock.mockClear();
});

describe("proofTableHead", () => {
  it("uses §7 columns without Tätigkeiten", () => {
    expect(proofTableHead()).toEqual([
      "Datum",
      "Einsatzort / Objekt",
      "Beginn",
      "Ende",
      "Stunden",
      "Leistungsart",
      "Notiz",
    ]);
    expect(proofTableHead().join("|")).not.toContain("Tätigkeiten");
  });
});

describe("buildProofTableRows", () => {
  it("maps street/houseNo/workCode and job name into §7 row", () => {
    const job = makeJob({ name: "Reinigung" });
    const shift = makeShift({
      street: "Musterstraße",
      houseNo: "10",
      workCode: "UR",
      start: "06:00",
      end: "07:00",
      date: "2026-09-20",
    });
    const [row] = buildProofTableRows([shift], [job]);
    expect(row).toEqual([
      "20.09.2026",
      "Reinigung",
      "06:00",
      "07:00",
      "1,00 h",
      "UR",
      expect.stringContaining("Musterstraße 10"),
    ]);
    expect(row![6]).toBe("Musterstraße 10");
  });

  it("keeps two same-day shifts with distinct Leistungsart and Notiz", () => {
    const job = makeJob({ name: "Reinigung" });
    const a = makeShift({
      id: "a",
      street: "Musterstraße",
      houseNo: "10",
      workCode: "UR",
      start: "06:00",
      end: "07:00",
    });
    const b = makeShift({
      id: "b",
      street: "Bahnhofstraße",
      houseNo: "20",
      workCode: "FR",
      start: "08:00",
      end: "09:30",
    });
    const rows = buildProofTableRows([a, b], [job]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual([
      "20.09.2026",
      "Reinigung",
      "06:00",
      "07:00",
      "1,00 h",
      "UR",
      "Musterstraße 10",
    ]);
    expect(rows[1]).toEqual([
      "20.09.2026",
      "Reinigung",
      "08:00",
      "09:30",
      "1,50 h",
      "FR",
      "Bahnhofstraße 20",
    ]);
  });

  it("sorts same-day entries by start time", () => {
    const sa = makeShift({ id: "sa", start: "06:00", end: "07:00", workCode: "SA" });
    const er = makeShift({ id: "er", start: "06:15", end: "07:15", workCode: "ER" });
    const rows = buildProofTableRows([er, sa], [makeJob()]);

    expect(rows.map((row) => [row[2], row[5]])).toEqual([
      ["06:00", "SA"],
      ["06:15", "ER"],
    ]);
  });

  it("uses stable id secondary when date and start match", () => {
    const b = makeShift({ id: "b-id", start: "06:00", end: "07:00", workCode: "UR" });
    const a = makeShift({ id: "a-id", start: "06:00", end: "07:00", workCode: "FR" });
    const rows = buildProofTableRows([b, a], [makeJob()]);
    expect(rows.map((row) => row[5])).toEqual(["FR", "UR"]);
  });

  it("sorts multiple days by date and then start time", () => {
    const rows = buildProofTableRows(
      [
        makeShift({ id: "d20-late", date: "2026-09-20", start: "08:00", workCode: "ER" }),
        makeShift({ id: "d19-late", date: "2026-09-19", start: "06:15", workCode: "FR" }),
        makeShift({ id: "d20-early", date: "2026-09-20", start: "05:30", workCode: "UR" }),
        makeShift({ id: "d19-early", date: "2026-09-19", start: "06:00", workCode: "SA" }),
      ],
      [makeJob()],
    );

    expect(rows.map((row) => [row[0], row[2], row[5]])).toEqual([
      ["19.09.2026", "06:00", "SA"],
      ["19.09.2026", "06:15", "FR"],
      ["20.09.2026", "05:30", "UR"],
      ["20.09.2026", "08:00", "ER"],
    ]);
  });

  it("prefers workplace over job name; empty workCode → —", () => {
    const rows = buildProofTableRows(
      [makeShift({ workplace: "Objekt Nord" })],
      [makeJob()],
    );
    expect(rows[0]![1]).toBe("Objekt Nord");
    expect(rows[0]![5]).toBe("—");
    expect(rows[0]![6]).toBe("");
  });
});

describe("filledAtLabel", () => {
  it("formats export timestamp as DD.MM.YYYY", () => {
    expect(filledAtLabel(new Date("2026-09-20T10:00:00.000Z"))).toBe("20.09.2026");
  });
});

describe("PDF export regression (real jspdf, no pdftotext)", () => {
  const job = makeJob();
  const shifts = [
    makeShift({
      street: "Musterstraße",
      houseNo: "10",
      workCode: "UR",
      start: "06:00",
      end: "07:00",
    }),
  ];

  function assertProofPdfMarkers(raw: string) {
    expect(raw).toContain("Leistungsart");
    expect(raw).toContain("UR");
    // ASCII-safe prefix; full "Musterstraße 10" also present with jspdf Helvetica
    expect(raw).toContain("Musterstra");
    expect(raw).toContain("3. OG");
    expect(raw).toContain("linke T");
    expect(raw).toContain("30159");
    expect(raw).toContain("Hannover");
    expect(raw).toContain("Ausgefüllt");
    expect(raw).not.toContain("Tätigkeiten");
  }

  const richShifts = [
    makeShift({
      street: "Musterstraße",
      houseNo: "10",
      floor: "3. OG",
      doorSide: "linke Tür",
      zip: "30159",
      city: "Hannover",
      workCode: "UR",
      start: "06:00",
      end: "07:00",
    }),
  ];

  it("exportArbeitsnachweisPdf embeds Leistungsart/UR/address/Ausgefüllt, not Tätigkeiten", () => {
    exportArbeitsnachweisPdf(richShifts, {
      jobs: [job],
      month: 8,
      year: 2026,
      employeeName: "Max Mustermann",
      employer: "Putz GmbH",
    });
    const raw = pdfLatin1FromLastSave();
    assertProofPdfMarkers(raw);
    expect(raw).toContain("Reinigung");
  });

  it("exportWorkReportPdf (Leistungsnachweis button) shares same markers", () => {
    exportWorkReportPdf(richShifts, {
      jobs: [job],
      month: "September 2026",
      employeeName: "Max Mustermann",
      includePhotos: false,
    });
    assertProofPdfMarkers(pdfLatin1FromLastSave());
  });

  it("old shift without floor/door/zip/city still exports street only", () => {
    exportArbeitsnachweisPdf(shifts, {
      jobs: [job],
      month: 8,
      year: 2026,
      employeeName: "Max Mustermann",
    });
    const raw = pdfLatin1FromLastSave();
    expect(raw).toContain("Musterstra");
    expect(raw).toContain("UR");
    expect(raw).not.toContain("Tätigkeiten");
  });

  it("PLZ/Ort appears exactly once in Notiz (no autoTable+didDrawCell double paint)", () => {
    // Single-shift export: each Notiz line must appear exactly once in the PDF stream.
    exportArbeitsnachweisPdf(richShifts, {
      jobs: [job],
      month: 8,
      year: 2026,
      employeeName: "Max Mustermann",
      employer: "Putz GmbH",
    });
    const raw = pdfLatin1FromLastSave();
    expect(raw.split("30159 Hannover").length - 1).toBe(1);
    expect(raw.split("Musterstraße").length - 1).toBe(1);
    expect(raw).toContain("Musterstraße 10, 3. OG, linke Tür");
    // Keep #102 markers
    assertProofPdfMarkers(raw);
  });
});

describe("Leistungsnachweis kind subtitle (not Job.name)", () => {
  const job = makeJob({ name: "Reinigung" });

  function exportLeistungsnachweis(list: Shift[]) {
    exportWorkReportPdf(list, {
      jobs: [job],
      month: "September 2026",
      includePhotos: false,
    });
    return pdfLatin1FromLastSave();
  }

  it("work-only PDF uses Arbeit, not Reinigung as the kind line", () => {
    const raw = exportLeistungsnachweis([makeShift({ kind: "arbeit", workCode: "ER" })]);
    expect(proofKindSummary([makeShift({ kind: "arbeit" })])).toBe("Arbeit");
    expect(raw).toContain("Arbeit");
    expect(raw).toContain("ER");
  });

  it("Urlaub-only PDF describes Urlaub and does not use Reinigung as the row", () => {
    const rows = buildProofTableRows([makeShift({ kind: "urlaub", jobId: "j1" })], [job]);
    expect(rows[0]![1]).toBe("Urlaub");
    expect(rows[0]![5]).toBe("Urlaub");
    const raw = exportLeistungsnachweis([makeShift({ kind: "urlaub", jobId: "j1" })]);
    expect(raw).toContain("Urlaub");
    expect(raw).not.toContain("Reinigung");
  });

  it("Krank-only PDF", () => {
    expect(exportLeistungsnachweis([makeShift({ kind: "krank" })])).toContain("Krank");
  });

  it("Feiertag-only PDF", () => {
    expect(exportLeistungsnachweis([makeShift({ kind: "feiertag" })])).toContain("Feiertag");
  });

  it("Frei-only PDF", () => {
    expect(exportLeistungsnachweis([makeShift({ kind: "frei" })])).toContain("Frei");
  });

  it("mixed Arbeit + absences: all kinds, Job.name is not the sole description", () => {
    const list = [
      makeShift({ id: "w", date: "2026-09-19", kind: "arbeit", start: "08:00", workCode: "ER" }),
      makeShift({ id: "u", date: "2026-09-21", kind: "urlaub", start: "00:00" }),
      makeShift({ id: "f", date: "2026-09-23", kind: "frei", start: "00:00" }),
      makeShift({ id: "h", date: "2026-09-25", kind: "feiertag", start: "00:00" }),
    ];
    expect(proofKindSummary(list)).toBe("Arbeit · Urlaub · Frei · Feiertag");
    const raw = exportLeistungsnachweis(list);
    expect(raw).toContain("Arbeit");
    expect(raw).toContain("Urlaub");
    expect(raw).toContain("Frei");
    expect(raw).toContain("Feiertag");
    expect(raw).toContain("ER");
    const rows = buildProofTableRows(list, [job]);
    expect(rows.map((r) => r[5])).toEqual(["ER", "Urlaub", "Frei", "Feiertag"]);
    expect(rows[0]![1]).toBe("Reinigung");
    expect(rows[1]![1]).not.toBe("Reinigung");
  });

  it("Arbeitsnachweis PDF keeps Leistungsart/address/order and absence labels", () => {
    const list = [
      makeShift({
        id: "w",
        date: "2026-09-19",
        kind: "arbeit",
        start: "08:00",
        workCode: "FR",
        street: "Musterstraße",
        houseNo: "10",
      }),
      makeShift({ id: "u", date: "2026-09-21", kind: "urlaub", start: "00:00" }),
    ];
    exportArbeitsnachweisPdf(list, {
      jobs: [job],
      month: 8,
      year: 2026,
      employeeName: "Max Mustermann",
    });
    const raw = pdfLatin1FromLastSave();
    expect(raw).toContain("Leistungsart");
    expect(raw).toContain("FR");
    expect(raw).toContain("Musterstra");
    expect(raw).toContain("Urlaub");
    const rows = buildProofTableRows(list, [job]);
    expect(rows.map((r) => [r[0], r[2], r[5]])).toEqual([
      ["19.09.2026", "08:00", "FR"],
      ["21.09.2026", "00:00", "Urlaub"],
    ]);
  });
});
