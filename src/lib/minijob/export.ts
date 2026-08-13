import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

import {
  formatDateDE,
  formatEuro,
  formatHours,
  shiftBreakdown,
  shiftHours,
  sumHours,
} from "./calc";
import { isHoliday } from "./holidays";
import { SHIFT_KIND_LABEL, type Job, type Shift } from "./types";

export interface ExportContext {
  jobs: Job[];
  bundesland: string;
}

function resolve(shift: Shift, ctx: ExportContext) {
  const job = ctx.jobs.find((j) => j.id === shift.jobId);
  return shiftBreakdown(shift, { job, holiday: isHoliday(shift.date, ctx.bundesland) });
}

function sorted(shifts: Shift[]) {
  return [...shifts].sort((a, b) => (a.date > b.date ? 1 : -1));
}

function total(shifts: Shift[], ctx: ExportContext) {
  return shifts.reduce((acc, s) => acc + resolve(s, ctx).total, 0);
}

function rows(shifts: Shift[], ctx: ExportContext) {
  return sorted(shifts).map((s) => {
    const b = resolve(s, ctx);
    return {
      Datum: formatDateDE(s.date),
      Job: ctx.jobs.find((j) => j.id === s.jobId)?.name ?? "–",
      Art: SHIFT_KIND_LABEL[s.kind],
      Beginn: s.start,
      Ende: s.end,
      "Pause (Min.)": s.breakMinutes,
      Stunden: Number(shiftHours(s).toFixed(2)),
      "Stundenlohn (EUR)": Number((s.rate || 0).toFixed(2)),
      "Zuschläge (EUR)": Number(b.bonus.toFixed(2)),
      "Verdienst (EUR)": Number(b.total.toFixed(2)),
      Notiz: s.note ?? "",
    };
  });
}

export function exportXlsx(shifts: Shift[], title: string, ctx: ExportContext) {
  const data = rows(shifts, ctx);
  data.push({
    Datum: "Gesamt",
    Job: "",
    Art: "",
    Beginn: "",
    Ende: "",
    "Pause (Min.)": "" as unknown as number,
    Stunden: Number(sumHours(shifts).toFixed(2)),
    "Stundenlohn (EUR)": "" as unknown as number,
    "Zuschläge (EUR)": "" as unknown as number,
    "Verdienst (EUR)": Number(total(shifts, ctx).toFixed(2)),
    Notiz: "",
  });
  const sheet = XLSX.utils.json_to_sheet(data);
  sheet["!cols"] = [12, 16, 10, 8, 8, 12, 10, 16, 14, 16, 24].map((wch) => ({ wch }));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Arbeitszeiten");
  XLSX.writeFile(book, `${title}.xlsx`);
}

export function exportPdf(shifts: Shift[], title: string, ctx: ExportContext) {
  const doc = new jsPDF();
  doc.setFontSize(16);
  doc.text("MiniJob Tracker", 14, 18);
  doc.setFontSize(11);
  doc.text(title, 14, 26);

  autoTable(doc, {
    startY: 32,
    head: [["Datum", "Job", "Art", "Zeit", "Pause", "Stunden", "Zuschlag", "Verdienst"]],
    body: sorted(shifts).map((s) => {
      const b = resolve(s, ctx);
      return [
        formatDateDE(s.date),
        ctx.jobs.find((j) => j.id === s.jobId)?.name ?? "–",
        SHIFT_KIND_LABEL[s.kind],
        `${s.start}–${s.end}`,
        `${s.breakMinutes} Min.`,
        formatHours(b.hours),
        formatEuro(b.bonus),
        formatEuro(b.total),
      ];
    }),
    foot: [
      [
        "Gesamt",
        "",
        "",
        "",
        "",
        formatHours(sumHours(shifts)),
        "",
        formatEuro(total(shifts, ctx)),
      ],
    ],
    styles: { fontSize: 8 },
    headStyles: { fillColor: [16, 122, 110] },
    footStyles: { fillColor: [230, 230, 230], textColor: 20, fontStyle: "bold" },
  });

  doc.save(`${title}.pdf`);
}
