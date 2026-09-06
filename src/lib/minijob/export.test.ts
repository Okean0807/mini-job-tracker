import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  writeFile,
  json_to_sheet,
  book_new,
  book_append_sheet,
  save,
  text,
  setFontSize,
  jsPdfCtor,
  autoTableMock,
} = vi.hoisted(() => {
  const writeFile = vi.fn();
  const json_to_sheet = vi.fn(() => ({ "!cols": undefined as unknown }));
  const book_new = vi.fn(() => ({}));
  const book_append_sheet = vi.fn();
  const save = vi.fn();
  const text = vi.fn();
  const setFontSize = vi.fn();
  const jsPdfCtor = vi.fn(function (this: unknown) {
    return { setFontSize, text, save };
  });
  const autoTableMock = vi.fn();
  return {
    writeFile,
    json_to_sheet,
    book_new,
    book_append_sheet,
    save,
    text,
    setFontSize,
    jsPdfCtor,
    autoTableMock,
  };
});

vi.mock("xlsx", () => ({
  utils: {
    json_to_sheet,
    book_new,
    book_append_sheet,
  },
  writeFile,
}));

vi.mock("jspdf", () => ({
  jsPDF: jsPdfCtor,
}));

vi.mock("jspdf-autotable", () => ({
  default: autoTableMock,
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
});

describe("exportXlsx", () => {
  it("schreibt eine XLSX-Datei mit Summenzeile", () => {
    exportXlsx(shifts, "Bericht-Maerz", ctx);
    expect(json_to_sheet).toHaveBeenCalledTimes(1);
    const firstCall = json_to_sheet.mock.calls[0] as unknown as [Record<string, unknown>[]];
    const rows = firstCall[0];
    expect(rows.length).toBe(2); // 1 Schicht + Summe
    expect(writeFile).toHaveBeenCalledWith(expect.anything(), "Bericht-Maerz.xlsx");
    expect(book_append_sheet).toHaveBeenCalled();
  });
});

describe("exportPdf", () => {
  it("erzeugt ein PDF mit Titel und Speichern", () => {
    exportPdf(shifts, "Bericht-Maerz", ctx);
    expect(jsPdfCtor).toHaveBeenCalled();
    expect(setFontSize).toHaveBeenCalled();
    expect(text).toHaveBeenCalled();
    expect(autoTableMock).toHaveBeenCalledTimes(1);
    const autoCall = autoTableMock.mock.calls[0] as unknown as [unknown, {
      body: unknown[];
      foot: unknown[];
    }];
    const opts = autoCall[1];
    expect(opts.body).toHaveLength(1);
    expect(opts.foot).toHaveLength(1);
    expect(save).toHaveBeenCalledWith("Bericht-Maerz.pdf");
  });
});
