import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

import {
  formatDateDE,
  formatEuro,
  formatHours,
  shiftEarnings,
  shiftHours,
  sumEarnings,
  sumHours,
} from "./calc";
import type { Shift } from "./types";

function rows(shifts: Shift[]) {
  return [...shifts]
    .sort((a, b) => (a.date > b.date ? 1 : -1))
    .map((s) => ({
      Datum: formatDateDE(s.date),
      Beginn: s.start,
      Ende: s.end,
      "Pause (Min.)": s.breakMinutes,
      Stunden: Number(shiftHours(s).toFixed(2)),
      "Stundenlohn (EUR)": Number(s.rate.toFixed(2)),
      "Verdienst (EUR)": Number(shiftEarnings(s).toFixed(2)),
      Notiz: s.note ?? "",
    }));
}

export function exportXlsx(shifts: Shift[], title: string) {
  const data = rows(shifts);
  data.push({
    Datum: "Gesamt",
    Beginn: "",
    Ende: "",
    "Pause (Min.)": "" as unknown as number,
    Stunden: Number(sumHours(shifts).toFixed(2)),
    "Stundenlohn (EUR)": "" as unknown as number,
    "Verdienst (EUR)": Number(sumEarnings(shifts).toFixed(2)),
    Notiz: "",
  });
  const sheet = XLSX.utils.json_to_sheet(data);
  sheet["!cols"] = [
    { wch: 12 },
    { wch: 8 },
    { wch: 8 },
    { wch: 12 },
    { wch: 10 },
    { wch: 16 },
    { wch: 16 },
    { wch: 24 },
  ];
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Arbeitszeiten");
  XLSX.writeFile(book, `${title}.xlsx`);
}

export function exportPdf(shifts: Shift[], title: string) {
  const doc = new jsPDF();
  doc.setFontSize(16);
  doc.text("MiniJob Tracker", 14, 18);
  doc.setFontSize(11);
  doc.text(title, 14, 26);

  autoTable(doc, {
    startY: 32,
    head: [["Datum", "Beginn", "Ende", "Pause", "Stunden", "Lohn/Std.", "Verdienst"]],
    body: [...shifts]
      .sort((a, b) => (a.date > b.date ? 1 : -1))
      .map((s) => [
        formatDateDE(s.date),
        s.start,
        s.end,
        `${s.breakMinutes} Min.`,
        formatHours(shiftHours(s)),
        formatEuro(s.rate),
        formatEuro(shiftEarnings(s)),
      ]),
    foot: [
      [
        "Gesamt",
        "",
        "",
        "",
        formatHours(sumHours(shifts)),
        "",
        formatEuro(sumEarnings(shifts)),
      ],
    ],
    styles: { fontSize: 9 },
    headStyles: { fillColor: [16, 122, 110] },
    footStyles: { fillColor: [230, 230, 230], textColor: 20, fontStyle: "bold" },
  });

  doc.save(`${title}.pdf`);
}
