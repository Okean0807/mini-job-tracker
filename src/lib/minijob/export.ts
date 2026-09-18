import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

import { td, DOCUMENT_LOCALE } from "./document-i18n";

import { formatDate, formatEuro, formatHours } from "./calc";
import { saveAndRegisterBytes } from "./generated-docs";
import { shiftPayroll } from "./payroll";
import { isHoliday } from "./holidays";
import { effectiveShiftRate } from "./rate";
import type { Job, Shift, Supplements } from "./types";

export interface ExportContext {
  jobs: Job[];
  bundesland: string;
  /** Standard-Stundenlohn als Fallback für Schichten ohne eigenen Satz */
  defaultRate?: number | undefined;
  /** Globale Zuschlagsregeln (greifen, wenn der Job keine eigenen hat) */
  supplements?: Supplements | undefined;
}

function resolve(shift: Shift, ctx: ExportContext, history: Shift[] = []) {
  const job = ctx.jobs.find((j) => j.id === shift.jobId);
  return shiftPayroll(shift, {
    job,
    supplements: ctx.supplements,
    holiday: isHoliday(shift.date, ctx.bundesland),
    defaultRate: ctx.defaultRate,
    history,
  });
}

/** Bezahlte Stunden einer Position (Arbeit oder Entgeltfortzahlung). */
function paidHours(p: { workedHours: number; paidAbsenceHours: number }) {
  return p.workedHours + p.paidAbsenceHours;
}

function totalHours(shifts: Shift[], ctx: ExportContext) {
  return shifts.reduce((acc, s) => acc + paidHours(resolve(s, ctx, shifts)), 0);
}

function sorted(shifts: Shift[]) {
  return [...shifts].sort((a, b) => (a.date > b.date ? 1 : -1));
}

function total(shifts: Shift[], ctx: ExportContext) {
  return shifts.reduce((acc, s) => acc + resolve(s, ctx, shifts).earnings, 0);
}

function rows(shifts: Shift[], ctx: ExportContext) {
  const dateLabel = td("label.date");
  const jobLabel = td("label.job");
  const kindLabel = td("label.kind");
  const startLabel = td("label.start");
  const endLabel = td("label.end");
  const breakLabel = td("label.breakMinutes");
  const hoursLabel = td("label.hours");
  const rateLabel = td("report.rateEur");
  const bonusLabel = td("report.bonusEur");
  const earningsLabel = td("report.earningsEur");
  const noteLabel = td("label.note");

  return sorted(shifts).map((s) => {
    const b = resolve(s, ctx, shifts);
    return {
      [dateLabel]: formatDate(s.date, DOCUMENT_LOCALE),
      [jobLabel]: ctx.jobs.find((j) => j.id === s.jobId)?.name ?? "–",
      [kindLabel]: td(`kind.${s.kind}`),
      [startLabel]: s.start,
      [endLabel]: s.end,
      [breakLabel]: s.breakMinutes,
      [hoursLabel]: Number(paidHours(b).toFixed(2)),
      [rateLabel]: Number(
        effectiveShiftRate(s, {
          job: ctx.jobs.find((j) => j.id === s.jobId),
          defaultRate: ctx.defaultRate,
        }).toFixed(2),
      ),
      [bonusLabel]: Number(b.bonus.toFixed(2)),
      [earningsLabel]: Number(b.earnings.toFixed(2)),
      [noteLabel]: s.note ?? "",
    };
  });
}

export function exportXlsx(shifts: Shift[], title: string, ctx: ExportContext) {
  const dateLabel = td("label.date");
  const jobLabel = td("label.job");
  const kindLabel = td("label.kind");
  const startLabel = td("label.start");
  const endLabel = td("label.end");
  const breakLabel = td("label.breakMinutes");
  const hoursLabel = td("label.hours");
  const rateLabel = td("report.rateEur");
  const bonusLabel = td("report.bonusEur");
  const earningsLabel = td("report.earningsEur");
  const noteLabel = td("label.note");

  const data = rows(shifts, ctx);
  data.push({
    [dateLabel]: td("label.total"),
    [jobLabel]: "",
    [kindLabel]: "",
    [startLabel]: "",
    [endLabel]: "",
    [breakLabel]: "" as unknown as number,
    [hoursLabel]: Number(totalHours(shifts, ctx).toFixed(2)),
    [rateLabel]: "" as unknown as number,
    [bonusLabel]: "" as unknown as number,
    [earningsLabel]: Number(total(shifts, ctx).toFixed(2)),
    [noteLabel]: "",
  });
  const sheet = XLSX.utils.json_to_sheet(data);
  sheet["!cols"] = [12, 16, 10, 8, 8, 12, 10, 16, 14, 16, 24].map((wch) => ({ wch }));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, td("report.sheetName"));
  const filename = `${title}.xlsx`;
  const buffer = XLSX.write(book, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  saveAndRegisterBytes({
    bytes: buffer,
    filename,
    category: "report_xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

export function exportPdf(shifts: Shift[], title: string, ctx: ExportContext) {
  const doc = new jsPDF();
  doc.setFontSize(16);
  doc.text(td("app.name"), 14, 18);
  doc.setFontSize(11);
  doc.text(title, 14, 26);

  autoTable(doc, {
    startY: 32,
    head: [
      [
        td("label.date"),
        td("label.job"),
        td("label.kind"),
        td("label.time"),
        td("label.break"),
        td("label.hours"),
        td("label.bonus"),
        td("label.earnings"),
      ],
    ],
    body: sorted(shifts).map((s) => {
      const b = resolve(s, ctx, shifts);
      return [
        formatDate(s.date, DOCUMENT_LOCALE),
        ctx.jobs.find((j) => j.id === s.jobId)?.name ?? "–",
        td(`kind.${s.kind}`),
        `${s.start}–${s.end}`,
        `${s.breakMinutes} ${td("label.minutes")}`,
        formatHours(paidHours(b), DOCUMENT_LOCALE),
        formatEuro(b.bonus, DOCUMENT_LOCALE),
        formatEuro(b.earnings, DOCUMENT_LOCALE),
      ];
    }),
    foot: [
      [
        td("label.total"),
        "",
        "",
        "",
        "",
        formatHours(totalHours(shifts, ctx), DOCUMENT_LOCALE),
        "",
        formatEuro(total(shifts, ctx), DOCUMENT_LOCALE),
      ],
    ],
    styles: { fontSize: 8 },
    headStyles: { fillColor: [16, 122, 110] },
    footStyles: { fillColor: [230, 230, 230], textColor: 20, fontStyle: "bold" },
  });

  const filename = `${title}.pdf`;
  const buffer = doc.output("arraybuffer") as ArrayBuffer;
  saveAndRegisterBytes({
    bytes: buffer,
    filename,
    category: "report_pdf",
    mimeType: "application/pdf",
  });
}
