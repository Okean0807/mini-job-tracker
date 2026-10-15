/**
 * QA P1-144-a: Statistik-Export (XLSX/PDF) muss Krankheitsfälle mit der VOLLEN
 * Historie bewerten. Fall beginnt 02.11.2026 (60 Tage, Plan Mo–So, 5 h × 15 €):
 * Dezember-Export = 13 bezahlte Tage = 975 €, nicht 31 Tage = 2325 €.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";

const { json_to_sheet, autoTableMock } = vi.hoisted(() => ({
  json_to_sheet: vi.fn((_rows: Record<string, unknown>[]) => ({ "!cols": undefined as unknown })),
  autoTableMock: vi.fn(),
}));

vi.mock("xlsx", () => ({
  utils: { json_to_sheet, book_new: vi.fn(() => ({})), book_append_sheet: vi.fn() },
  write: vi.fn(() => new Uint8Array([80, 75]).buffer),
  writeFile: vi.fn(),
}));
vi.mock("jspdf", () => ({
  jsPDF: vi.fn(function (this: unknown) {
    return {
      setFontSize: vi.fn(),
      text: vi.fn(),
      save: vi.fn(),
      output: vi.fn(() => new Uint8Array([37]).buffer),
    };
  }),
}));
vi.mock("jspdf-autotable", () => ({ default: autoTableMock }));
vi.mock("./generated-docs", () => ({ saveAndRegisterBytes: vi.fn(() => ({ id: "x" })) }));

import { isoDate } from "./calc";
import { td } from "./document-i18n";
import { exportPdf, exportXlsx } from "./export";
import type { Job, Shift } from "./types";

const day = { start: "09:00", end: "14:00", breakMinutes: 0 };
const job = {
  id: "j1",
  name: "Reinigung",
  rate: 15,
  color: "#000",
  week: Array.from({ length: 7 }, () => ({ active: true, ...day })),
  startDate: "2026-01-01",
} as unknown as Job;

const all: Shift[] = Array.from({ length: 60 }, (_, i) => ({
  id: `k${i}`,
  jobId: "j1",
  kind: "krank" as const,
  date: isoDate(new Date(2026, 10, 2 + i)),
  ...day,
}));
const december = all.filter((s) => s.date.startsWith("2026-12"));
const ctx = { jobs: [job], bundesland: "NW", defaultRate: 15 };

function xlsxTotal(): number {
  const rows = json_to_sheet.mock.calls.at(-1)![0];
  return rows[rows.length - 1]![td("report.earningsEur")] as number;
}

beforeEach(() => vi.clearAllMocks());

describe("P1-144-a Export mit voller Historie", () => {
  it("Dezember-Liste: 31 Einträge, Fall begann am 02.11.", () => {
    expect(december).toHaveLength(31);
    expect(all[0]!.date).toBe("2026-11-02");
  });

  it("XLSX Dezember mit history = 975 €", () => {
    exportXlsx(december, "Dezember", { ...ctx, history: all });
    expect(xlsxTotal()).toBe(975);
  });

  it("XLSX Dezember ohne history (Altverhalten) = 2325 € – deshalb muss der Aufrufer history geben", () => {
    exportXlsx(december, "Dezember", ctx);
    expect(xlsxTotal()).toBe(2325);
  });

  it("PDF Dezember mit history: Summenzeile 975 €", () => {
    exportPdf(december, "Dezember", { ...ctx, history: all });
    const opts = autoTableMock.mock.calls.at(-1)![1] as { foot: string[][] };
    const foot = opts.foot[0]!.join(" ");
    expect(foot).toMatch(/975/);
    expect(foot).not.toMatch(/2\.?325/);
  });

  it("statistik.tsx übergibt die volle Historie an den Export", () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../routes/statistik.tsx"),
      "utf8",
    );
    expect(src).toMatch(/history:\s*shifts,/);
  });
});
