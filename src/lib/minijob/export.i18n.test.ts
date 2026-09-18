import { beforeEach, describe, expect, it, vi } from "vitest";

const { write, json_to_sheet, book_new, book_append_sheet, output, text, setFontSize, jsPdfCtor, autoTableMock } =
  vi.hoisted(() => {
    const write = vi.fn(() => new Uint8Array([80, 75]).buffer);
    const json_to_sheet = vi.fn(() => ({ "!cols": undefined as unknown }));
    const book_new = vi.fn(() => ({}));
    const book_append_sheet = vi.fn();
    const output = vi.fn(() => new Uint8Array([37, 80, 68, 70]).buffer); // %PDF
    const text = vi.fn();
    const setFontSize = vi.fn();
    const jsPdfCtor = vi.fn(function (this: unknown) {
      return { setFontSize, text, save: vi.fn(), output };
    });
    const autoTableMock = vi.fn();
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
    };
  });

vi.mock("xlsx", () => ({
  utils: { json_to_sheet, book_new, book_append_sheet },
  write,
  writeFile: vi.fn(),
}));

vi.mock("jspdf", () => ({ jsPDF: jsPdfCtor }));
vi.mock("jspdf-autotable", () => ({ default: autoTableMock }));

vi.mock("./generated-docs", async () => {
  const actual = await vi.importActual<typeof import("./generated-docs")>("./generated-docs");
  return {
    ...actual,
    saveAndRegisterBytes: vi.fn((opts: { filename: string; category: string }) => ({
      id: "gen-1",
      name: opts.filename,
      category: opts.category,
      mimeType: "application/pdf",
      size: 4,
      createdAt: new Date().toISOString(),
      dataUrl: "",
      source: "generated" as const,
    })),
  };
});

import { tl } from "@/lib/i18n";
import { updateSettings, loadFromStorage } from "./store";
import { exportPdf, exportXlsx } from "./export";
import { arbeitsnachweisLabels } from "./arbeitsnachweis";
import { shiftBreakdown } from "./calc";
import { DEFAULT_SUPPLEMENTS, type Job, type Shift } from "./types";
import { saveAndRegisterBytes } from "./generated-docs";
import { clearGeneratedDocuments } from "./generated-docs";

const job = {
  id: "j1",
  name: "Reinigung",
  rate: 15,
  color: "#000",
  week: Array.from({ length: 7 }, () => ({
    active: false,
    start: "09:00",
    end: "14:00",
    breakMinutes: 0,
  })),
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
    rate: 15,
  } as Shift,
];

const ctx = { jobs: [job], bundesland: "NW", defaultRate: 15 };

beforeEach(() => {
  vi.clearAllMocks();
  clearGeneratedDocuments();
  loadFromStorage();
  updateSettings({ language: "de" });
  json_to_sheet.mockReturnValue({ "!cols": undefined });
  book_new.mockReturnValue({});
  write.mockReturnValue(new Uint8Array([80, 75]).buffer);
  output.mockReturnValue(new Uint8Array([37, 80, 68, 70]).buffer);
});

describe("export DE labels (Batch E)", () => {
  it("PDF head uses German labels when language=de", () => {
    updateSettings({ language: "de" });
    exportPdf(shifts, "Monatsbericht März 2026", ctx);
    expect(autoTableMock).toHaveBeenCalled();
    const opts = autoTableMock.mock.calls[0]![1] as { head: string[][] };
    expect(opts.head[0]).toEqual([
      "Datum",
      "Job",
      "Art",
      "Zeit",
      "Pause",
      "Stunden",
      "Zuschläge",
      "Verdienst",
    ]);
    expect(saveAndRegisterBytes).toHaveBeenCalledWith(
      expect.objectContaining({ category: "report_pdf", filename: "Monatsbericht März 2026.pdf" }),
    );
  });

  it("XLSX column keys are German when language=de", () => {
    updateSettings({ language: "de" });
    exportXlsx(shifts, "Monatsbericht", ctx);
    const call = json_to_sheet.mock.calls[0] as unknown as [Record<string, unknown>[]];
    const rows = call[0];
    expect(Object.keys(rows[0]!)).toEqual(
      expect.arrayContaining(["Datum", "Job", "Art", "Beginn", "Ende", "Stunden", "Verdienst (€)"]),
    );
    expect(saveAndRegisterBytes).toHaveBeenCalledWith(
      expect.objectContaining({ category: "report_xlsx" }),
    );
  });

  it("PDF head switches to English when language=en", () => {
    updateSettings({ language: "en" });
    exportPdf(shifts, "Month report", ctx);
    const opts = autoTableMock.mock.calls[0]![1] as { head: string[][] };
    expect(opts.head[0]).toEqual([
      tl("en", "label.date"),
      tl("en", "label.job"),
      tl("en", "label.kind"),
      tl("en", "label.time"),
      tl("en", "label.break"),
      tl("en", "label.hours"),
      tl("en", "label.bonus"),
      tl("en", "label.earnings"),
    ]);
    expect(opts.head[0]).not.toContain("Datum");
  });
});

describe("Arbeitsnachweis DE labels", () => {
  it("exposes correct German proof strings", () => {
    updateSettings({ language: "de" });
    const L = arbeitsnachweisLabels();
    expect(L.title).toBe("Arbeitsnachweis");
    expect(L.employee).toBe("Mitarbeiter");
    expect(L.employer).toBe("Arbeitgeber");
    expect(L.month).toBe("Monat");
    expect(L.date).toBe("Datum");
    expect(L.start).toBe("Beginn");
    expect(L.break).toBe("Pause");
    expect(L.end).toBe("Ende");
    expect(L.workHours).toBe("Arbeitszeit (h)");
    expect(L.recordedAt).toBe("Erfasst am");
    expect(L.remark).toBe("Bemerkung");
    expect(L.totalHours).toBe("Gesamtstunden");
    expect(L.placeDate).toBe("Ort, Datum");
    expect(L.signEmployee).toBe("Unterschrift Mitarbeiter");
    expect(L.pageOf(1, 2)).toBe("Seite 1 von 2");
  });

  it("does not mix DE labels when language=en", () => {
    updateSettings({ language: "en" });
    const L = arbeitsnachweisLabels();
    expect(L.title).toBe("Work record");
    expect(L.employee).toBe("Employee");
    expect(L.title).not.toBe("Arbeitsnachweis");
  });
});

describe("shiftBreakdown bonus labels follow language", () => {
  it("DE", () => {
    updateSettings({ language: "de" });
    const b = shiftBreakdown(
      { ...shifts[0]!, date: "2026-03-08" } as Shift,
      {
        supplements: {
          ...DEFAULT_SUPPLEMENTS,
          sunday: { enabled: true, mode: "prozent", value: 50 },
        },
      },
    );
    expect(b.labels).toEqual(["Sonntag"]);
  });

  it("EN", () => {
    updateSettings({ language: "en" });
    const b = shiftBreakdown(
      { ...shifts[0]!, date: "2026-03-08" } as Shift,
      {
        supplements: {
          ...DEFAULT_SUPPLEMENTS,
          sunday: { enabled: true, mode: "prozent", value: 50 },
        },
      },
    );
    expect(b.labels).toEqual([tl("en", "supp.sunday")]);
    expect(b.labels).not.toContain("Sonntag");
  });
});
