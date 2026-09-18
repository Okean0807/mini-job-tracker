import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  write,
  json_to_sheet,
  book_new,
  book_append_sheet,
  output,
  text,
  setFontSize,
  jsPdfCtor,
  autoTableMock,
  saveAndRegisterBytes,
} = vi.hoisted(() => {
  const write = vi.fn(() => new Uint8Array([80, 75]).buffer);
  const json_to_sheet = vi.fn(() => ({ "!cols": undefined as unknown }));
  const book_new = vi.fn(() => ({}));
  const book_append_sheet = vi.fn();
  const output = vi.fn(() => new Uint8Array([37, 80, 68, 70]).buffer);
  const text = vi.fn();
  const setFontSize = vi.fn();
  const jsPdfCtor = vi.fn(function (this: unknown) {
    return { setFontSize, text, save: vi.fn(), output };
  });
  const autoTableMock = vi.fn();
  const saveAndRegisterBytes = vi.fn((opts: { filename: string; category: string }) => ({
    id: "gen-1",
    name: opts.filename,
    category: opts.category,
    mimeType: "application/octet-stream",
    size: 2,
    createdAt: new Date().toISOString(),
    dataUrl: "",
    source: "generated" as const,
  }));
  return {
    write,
    json_to_sheet,
    book_new,
    book_append_sheet,
    output,
    text,
    setFontSize,
    jsPdfCtor,
    autoTableMock,
    saveAndRegisterBytes,
  };
});

vi.mock("xlsx", () => ({
  utils: {
    json_to_sheet,
    book_new,
    book_append_sheet,
  },
  write,
  writeFile: vi.fn(),
}));

vi.mock("jspdf", () => ({
  jsPDF: jsPdfCtor,
}));

vi.mock("jspdf-autotable", () => ({
  default: autoTableMock,
}));

vi.mock("./generated-docs", () => ({
  saveAndRegisterBytes,
}));

import { exportPdf, exportXlsx } from "./export";
import type { Job, Shift } from "./types";

const job: Job = {
  id: "j1",
  name: "Reinigung",
  rate: 15,
  color: "#000",
  week: [
    { active: true, start: "09:00", end: "14:00", breakMinutes: 0 },
    { active: true, start: "09:00", end: "14:00", breakMinutes: 0 },
    { active: false, start: "09:00", end: "14:00", breakMinutes: 0 },
    { active: false, start: "09:00", end: "14:00", breakMinutes: 0 },
    { active: false, start: "09:00", end: "14:00", breakMinutes: 0 },
    { active: false, start: "09:00", end: "14:00", breakMinutes: 0 },
    { active: false, start: "09:00", end: "14:00", breakMinutes: 0 },
  ],
  startDate: "2026-01-01",
} as unknown as Job;

const shifts: Shift[] = [
  {
    id: "s1",
    jobId: "j1",
    date: "2026-03-02",
    start: "09:00",
    end: "14:00",
    breakMinutes: 0,
    kind: "arbeit",
  } as Shift,
];

const ctx = { jobs: [job], bundesland: "NW", defaultRate: 15 };

beforeEach(() => {
  vi.clearAllMocks();
  json_to_sheet.mockReturnValue({ "!cols": undefined });
  book_new.mockReturnValue({});
  write.mockReturnValue(new Uint8Array([80, 75]).buffer);
  output.mockReturnValue(new Uint8Array([37, 80, 68, 70]).buffer);
});

describe("exportXlsx", () => {
  it("schreibt eine XLSX-Datei mit Summenzeile und registriert sie", () => {
    exportXlsx(shifts, "Bericht-Maerz", ctx);
    expect(json_to_sheet).toHaveBeenCalledTimes(1);
    const firstCall = json_to_sheet.mock.calls[0] as unknown as [Record<string, unknown>[]];
    const rows = firstCall[0];
    expect(rows.length).toBe(2); // 1 Schicht + Summe
    expect(write).toHaveBeenCalled();
    expect(book_append_sheet).toHaveBeenCalled();
    expect(saveAndRegisterBytes).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: "Bericht-Maerz.xlsx",
        category: "report_xlsx",
      }),
    );
  });
});

describe("exportPdf", () => {
  it("erzeugt ein PDF mit Titel und registriert es", () => {
    exportPdf(shifts, "Bericht-Maerz", ctx);
    expect(jsPdfCtor).toHaveBeenCalled();
    expect(setFontSize).toHaveBeenCalled();
    expect(text).toHaveBeenCalled();
    expect(autoTableMock).toHaveBeenCalledTimes(1);
    const autoCall = autoTableMock.mock.calls[0] as unknown as [
      unknown,
      {
        body: unknown[];
        foot: unknown[];
      },
    ];
    const opts = autoCall[1];
    expect(opts.body).toHaveLength(1);
    expect(opts.foot).toHaveLength(1);
    expect(output).toHaveBeenCalledWith("arraybuffer");
    expect(saveAndRegisterBytes).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: "Bericht-Maerz.pdf",
        category: "report_pdf",
      }),
    );
  });
});
