import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

function pdfTextFromLastSave(): string {
  const call = saveMock.mock.calls.at(-1)?.[0] as { bytes: ArrayBuffer } | undefined;
  expect(call?.bytes).toBeTruthy();
  const dir = mkdtempSync(join(tmpdir(), "proof-pdf-"));
  const pdfPath = join(dir, "out.pdf");
  writeFileSync(pdfPath, Buffer.from(call!.bytes));
  return execFileSync("pdftotext", ["-layout", pdfPath, "-"], { encoding: "utf8" });
}

/** Collapse whitespace so wrapped PDF headers like "Leistungs\nart" still match. */
function compact(text: string): string {
  return text.replace(/\s+/g, "");
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

describe("PDF export regression (real jspdf + pdftotext)", () => {
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

  it("exportArbeitsnachweisPdf contains Leistungsart/UR/address/Ausgefüllt am, not Tätigkeiten", () => {
    exportArbeitsnachweisPdf(shifts, {
      jobs: [job],
      month: 8,
      year: 2026,
      employeeName: "Max Mustermann",
      employer: "Putz GmbH",
    });
    const text = pdfTextFromLastSave();
    const c = compact(text);
    expect(c).toContain("Leistungsart");
    expect(text).toContain("UR");
    expect(c).toContain("Musterstraße10");
    expect(c).toContain("Ausgefülltam");
    expect(text).toContain("Reinigung");
    expect(c).not.toContain("Tätigkeiten");
  });

  it("exportWorkReportPdf (Leistungsnachweis button) shares same columns/data", () => {
    exportWorkReportPdf(shifts, {
      jobs: [job],
      month: "September 2026",
      employeeName: "Max Mustermann",
      includePhotos: false,
    });
    const text = pdfTextFromLastSave();
    const c = compact(text);
    expect(c).toContain("Leistungsart");
    expect(text).toContain("UR");
    expect(c).toContain("Musterstraße10");
    expect(c).toContain("Ausgefülltam");
    expect(c).not.toContain("Tätigkeiten");
  });
});
