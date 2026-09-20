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
    expect(raw).toContain("Ausgefüllt");
    expect(raw).not.toContain("Tätigkeiten");
  }

  it("exportArbeitsnachweisPdf embeds Leistungsart/UR/address/Ausgefüllt, not Tätigkeiten", () => {
    exportArbeitsnachweisPdf(shifts, {
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
    exportWorkReportPdf(shifts, {
      jobs: [job],
      month: "September 2026",
      employeeName: "Max Mustermann",
      includePhotos: false,
    });
    assertProofPdfMarkers(pdfLatin1FromLastSave());
  });
});
