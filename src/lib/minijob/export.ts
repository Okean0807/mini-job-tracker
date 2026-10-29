import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

import { td, DOCUMENT_LOCALE } from "./document-i18n";
import { appendXlsxSheet, createXlsxBook, createXlsxSheet, writeXlsx } from "./xlsx-export";

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
  /**
   * ALLE bekannten Einträge für die Bewertung (Krankheitsfall-Beginn, 13-Wochen-Durchschnitt).
   * Sie bestimmen nur die Berechnung, nicht welche Zeilen exportiert werden: der Bericht enthält
   * weiterhin genau die übergebenen `shifts`. Ohne Angabe gelten die exportierten Einträge selbst als
   * Historie (bisheriges Verhalten, richtig nur, wenn der Export alle Einträge enthält).
   */
  history?: Shift[] | undefined;
  /**
   * Soll-Stunden des exportierten Zeitraums (Plan fester Jobs). `null`/fehlend = nicht verfügbar;
   * der Bericht zeigt dann "–" statt einer erfundenen Zahl.
   */
  sollHours?: number | null | undefined;
}

function resolve(shift: Shift, ctx: ExportContext, exported: Shift[] = []) {
  const job = ctx.jobs.find((j) => j.id === shift.jobId);
  return shiftPayroll(shift, {
    job,
    supplements: ctx.supplements,
    holiday: isHoliday(shift.date, ctx.bundesland),
    defaultRate: ctx.defaultRate,
    history: ctx.history ?? exported,
  });
}

/** Bezahlte Stunden einer Position (Arbeit oder Entgeltfortzahlung). */
function paidHours(p: { workedHours: number; paidAbsenceHours: number }) {
  return p.workedHours + p.paidAbsenceHours;
}

function totalHours(shifts: Shift[], ctx: ExportContext) {
  return shifts.reduce((acc, s) => acc + paidHours(resolve(s, ctx, shifts)), 0);
}

/** Die vier getrennten Stundenkennzahlen des exportierten Zeitraums. */
function hoursBreakdown(shifts: Shift[], ctx: ExportContext) {
  let worked = 0;
  let paidAbsence = 0;
  for (const s of shifts) {
    const b = resolve(s, ctx, shifts);
    worked += b.workedHours;
    paidAbsence += b.paidAbsenceHours;
  }
  return { worked, paidAbsence, paidTotal: worked + paidAbsence, soll: ctx.sollHours ?? null };
}

/** Nicht bezahlte Abwesenheit: kein Arbeitsintervall und keine Stunden, sondern der Grund. */
function isUnpaidAbsence(p: { kind: string; paid: boolean }) {
  return p.kind !== "arbeit" && !p.paid;
}

/** Vergütungsgrund (z. B. "6-Wochen-Frist je Krankheitsfall überschritten"); leer bei Arbeit. */
function payStatus(p: { kind: string; reason: string }) {
  return p.kind === "arbeit" ? "" : td(`pay.reason.${p.reason}`);
}

const SOLL_NA = "–";

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
  const hoursLabel = td("hours.paidTotal");
  const rateLabel = td("report.rateEur");
  const bonusLabel = td("report.bonusEur");
  const earningsLabel = td("report.earningsEur");
  const noteLabel = td("label.note");
  const workedLabel = td("hours.worked");
  const absenceLabel = td("hours.paidAbsence");
  const sollLabel = td("hours.soll");
  const statusLabel = td("hours.payStatus");

  return sorted(shifts).map((s) => {
    const b = resolve(s, ctx, shifts);
    const unpaid = isUnpaidAbsence(b);
    return {
      [dateLabel]: formatDate(s.date, DOCUMENT_LOCALE),
      [jobLabel]: ctx.jobs.find((j) => j.id === s.jobId)?.name ?? "–",
      [kindLabel]: td(`kind.${s.kind}`),
      // Unbezahlte Abwesenheit: das gespeicherte Intervall ist kein Arbeits-/Bezahlzeitraum.
      [startLabel]: unpaid ? "" : s.start,
      [endLabel]: unpaid ? "" : s.end,
      [breakLabel]: (unpaid ? "" : s.breakMinutes) as number,
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
      [workedLabel]: Number(b.workedHours.toFixed(2)),
      [absenceLabel]: Number(b.paidAbsenceHours.toFixed(2)),
      [sollLabel]: "" as unknown as number,
      [statusLabel]: payStatus(b),
    };
  });
}

export function exportXlsx(shifts: Shift[], title: string, ctx: ExportContext) {
  const workedLabel = td("hours.worked");
  const absenceLabel = td("hours.paidAbsence");
  const sollLabel = td("hours.soll");
  const statusLabel = td("hours.payStatus");
  const dateLabel = td("label.date");
  const jobLabel = td("label.job");
  const kindLabel = td("label.kind");
  const startLabel = td("label.start");
  const endLabel = td("label.end");
  const breakLabel = td("label.breakMinutes");
  const hoursLabel = td("hours.paidTotal");
  const rateLabel = td("report.rateEur");
  const bonusLabel = td("report.bonusEur");
  const earningsLabel = td("report.earningsEur");
  const noteLabel = td("label.note");

  const data = rows(shifts, ctx);
  const hb = hoursBreakdown(shifts, ctx);
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
    [workedLabel]: Number(hb.worked.toFixed(2)),
    [absenceLabel]: Number(hb.paidAbsence.toFixed(2)),
    [sollLabel]: (hb.soll === null ? SOLL_NA : Number(hb.soll.toFixed(2))) as number,
    [statusLabel]: "",
  });
  const sheet = createXlsxSheet(data);
  sheet["!cols"] = [12, 16, 10, 8, 8, 12, 14, 16, 14, 16, 24, 14, 16, 12, 36].map((wch) => ({
    wch,
  }));
  const book = createXlsxBook();
  appendXlsxSheet(book, sheet, td("report.sheetName"));
  const filename = `${title}.xlsx`;
  const buffer = writeXlsx(book) as ArrayBuffer;
  saveAndRegisterBytes({
    bytes: buffer,
    filename,
    category: "report_xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

/**
 * Mindestbreiten (mm) der Listen-PDF-Spalten, damit Datum, Beträge und Überschriften nicht mitten im
 * Wort umbrechen. Reihenfolge wie die Spalten: Datum, Job, Art, Zeit, Pause, Gesamtstunden bezahlt,
 * Zuschläge, Verdienst, Gearbeitete Stunden, Bezahlte Abwesenheitsstunden.
 */
export const PDF_LIST_MIN_WIDTHS = [24, 20, 16, 50, 16, 30, 22, 28, 26, 36] as const;

export function exportPdf(shifts: Shift[], title: string, ctx: ExportContext) {
  // Querformat: zehn Spalten (vier Stundenkennzahlen) passen im Hochformat nicht lesbar.
  const doc = new jsPDF({ orientation: "landscape", format: "a4" });
  doc.setFontSize(16);
  doc.text(td("app.name"), 14, 18);
  doc.setFontSize(11);
  doc.text(title, 14, 26);

  // Vier getrennte Stundenkennzahlen statt einer vieldeutigen "Stunden"-Summe.
  const hb = hoursBreakdown(shifts, ctx);
  doc.setFontSize(9);
  [
    [td("hours.worked"), formatHours(hb.worked, DOCUMENT_LOCALE)],
    [td("hours.paidAbsence"), formatHours(hb.paidAbsence, DOCUMENT_LOCALE)],
    [td("hours.paidTotal"), formatHours(hb.paidTotal, DOCUMENT_LOCALE)],
    [td("hours.soll"), hb.soll === null ? SOLL_NA : formatHours(hb.soll, DOCUMENT_LOCALE)],
  ].forEach(([label, value], i) => doc.text(`${label}: ${value}`, 14, 33 + i * 5));

  autoTable(doc, {
    startY: 56,
    head: [
      [
        td("label.date"),
        td("label.job"),
        td("label.kind"),
        td("label.time"),
        td("label.break"),
        td("hours.paidTotal"),
        td("label.bonus"),
        td("label.earnings"),
        td("hours.worked"),
        td("hours.paidAbsence"),
      ],
    ],
    body: sorted(shifts).map((s) => {
      const b = resolve(s, ctx, shifts);
      const unpaid = isUnpaidAbsence(b);
      return [
        formatDate(s.date, DOCUMENT_LOCALE),
        ctx.jobs.find((j) => j.id === s.jobId)?.name ?? "–",
        td(`kind.${s.kind}`),
        // Unbezahlte Abwesenheit: Grund statt des gespeicherten Intervalls.
        unpaid ? `${td("pay.absenceUnpaid")}\n${payStatus(b)}` : `${s.start}–${s.end}`,
        unpaid ? "–" : `${s.breakMinutes} ${td("label.minutes")}`,
        formatHours(paidHours(b), DOCUMENT_LOCALE),
        formatEuro(b.bonus, DOCUMENT_LOCALE),
        formatEuro(b.earnings, DOCUMENT_LOCALE),
        formatHours(b.workedHours, DOCUMENT_LOCALE),
        formatHours(b.paidAbsenceHours, DOCUMENT_LOCALE),
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
        formatHours(hb.worked, DOCUMENT_LOCALE),
        formatHours(hb.paidAbsence, DOCUMENT_LOCALE),
      ],
    ],
    styles: { fontSize: 8 },
    columnStyles: Object.fromEntries(
      PDF_LIST_MIN_WIDTHS.map((minCellWidth, i) => [i, { minCellWidth }]),
    ),
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
