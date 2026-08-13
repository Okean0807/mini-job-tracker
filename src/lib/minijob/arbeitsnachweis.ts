import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

import { shiftHours, sumHours } from "./calc";
import type { Job, Shift } from "./types";

/** Leistungsarten (DATEV-Stil Kürzel) für den Arbeitsnachweis. */
export const WORK_CODES = ["UR", "FR", "ER", "BR", "SR"] as const;
export type WorkCode = (typeof WORK_CODES)[number];

export const WORK_CODE_LABELS: Record<WorkCode, string> = {
  UR: "Unterhaltsreinigung",
  FR: "Fensterreinigung",
  ER: "Endreinigung",
  BR: "Büroreinigung",
  SR: "Sonderreinigung",
};

const MONTHS_DE = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
];

function de(date: string | undefined): string {
  if (!date) return "";
  const [y, m, d] = date.slice(0, 10).split("-");
  if (!y || !m || !d) return "";
  return `${d}.${m}.${y}`;
}

function num(value: number, digits = 2): string {
  return value.toFixed(digits).replace(".", ",");
}

function slug(text: string): string {
  return (
    text
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/ä/gi, "ae")
      .replace(/ö/gi, "oe")
      .replace(/ü/gi, "ue")
      .replace(/ß/g, "ss")
      .replace(/[^A-Za-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "Mitarbeiter"
  );
}

/** Kompakte Adresszeile: „Musterstraße 15, 3. OG, links“. */
export function addressLine(shift: Shift, jobs: Job[] = []): string {
  const street = [shift.street, shift.houseNo]
    .map((part) => (part ?? "").trim())
    .filter(Boolean)
    .join(" ");
  const place = street || shift.workplace || jobs.find((j) => j.id === shift.jobId)?.name || "";
  return [place, shift.floor, shift.doorSide]
    .map((part) => (part ?? "").trim())
    .filter(Boolean)
    .join(", ");
}

/** Leistungszeile: „UR“ oder „SR: Wasserschaden“. */
export function codeLine(shift: Shift): string {
  const code = (shift.workCode ?? "").trim();
  const detail = (shift.workCodeNote ?? shift.note ?? "").trim().replace(/\s+/g, " ");
  if (!code) return detail.slice(0, 60);
  return detail ? `${code}: ${detail.slice(0, 50)}` : code;
}

/** Maximal zwei Zeilen pro Eintrag: Adresse + Leistungsart. */
export function remarkText(shift: Shift, jobs: Job[] = []): string {
  return [addressLine(shift, jobs), codeLine(shift)].filter(Boolean).join("\n");
}

export interface ArbeitsnachweisContext {
  jobs: Job[];
  /** 0-basierter Monat */
  month: number;
  year: number;
  employeeName: string;
  employer?: string;
  /** Eigene Leistungsarten für die Legende */
  customCodes?: { code: string; label: string }[];
}

/** DATEV-inspirierter Arbeitsnachweis: A4 quer, Schwarz-Weiß, druckfertig. */
export function exportArbeitsnachweisPdf(shifts: Shift[], ctx: ArbeitsnachweisContext) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 14;
  const monthLabel = `${MONTHS_DE[ctx.month] ?? ""} ${ctx.year}`;
  const list = [...shifts].sort((a, b) => (a.date > b.date ? 1 : -1));
  const totalHours = sumHours(list);

  const header = () => {
    doc.setTextColor(0, 0, 0);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("Arbeitsnachweis", margin, 14);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    const info = [
      `Mitarbeiter: ${ctx.employeeName || "—"}`,
      `Monat: ${monthLabel}`,
      ctx.employer ? `Auftraggeber: ${ctx.employer}` : "",
    ]
      .filter(Boolean)
      .join("     ·     ");
    doc.text(info, margin, 21);
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.4);
    doc.line(margin, 24, pageWidth - margin, 24);
  };

  autoTable(doc, {
    startY: 28,
    margin: { left: margin, right: margin, top: 28, bottom: 16 },
    theme: "grid",
    head: [
      ["Datum", "Beginn", "Pause", "Ende", "Std. (h)", "Erfasst am", "Bemerkung"],
    ],
    body: list.map((s) => [
      de(s.date),
      s.start,
      `${s.breakMinutes} min`,
      s.end,
      num(shiftHours(s)),
      de(s.createdAt),
      remarkText(s, ctx.jobs),
    ]),
    foot: [
      [
        { content: "Gesamtstunden:", colSpan: 4, styles: { halign: "right" as const } },
        { content: `${num(totalHours)} h`, styles: { halign: "right" as const } },
        "",
        "",
      ],
    ],
    styles: {
      font: "helvetica",
      fontSize: 7,
      cellPadding: { top: 0.6, bottom: 0.6, left: 1.5, right: 1.5 },
      minCellHeight: 0,
      textColor: [0, 0, 0],
      lineColor: [0, 0, 0],
      lineWidth: 0.15,
      valign: "top",
      overflow: "linebreak",
    },
    headStyles: {
      fillColor: [235, 235, 235],
      textColor: [0, 0, 0],
      fontStyle: "bold",
      lineWidth: 0.3,
      halign: "left",
    },
    footStyles: {
      fillColor: [255, 255, 255],
      textColor: [0, 0, 0],
      fontStyle: "bold",
      lineWidth: 0.3,
    },
    columnStyles: {
      0: { cellWidth: 20 },
      1: { cellWidth: 15, halign: "center" },
      2: { cellWidth: 15, halign: "center" },
      3: { cellWidth: 15, halign: "center" },
      4: { cellWidth: 16, halign: "right" },
      5: { cellWidth: 20 },
      6: { cellWidth: "auto" },
    },
    rowPageBreak: "avoid",
    showHead: "everyPage",
    showFoot: "lastPage",
    didDrawPage: () => {
      header();
    },
  });

  // Legende der verwendeten Leistungsarten + Unterschriftsbereich
  const labels = new Map<string, string>(Object.entries(WORK_CODE_LABELS));
  (ctx.customCodes ?? []).forEach((c) => labels.set(c.code, c.label));
  const used = [...new Set(list.map((s) => (s.workCode ?? "").trim()).filter(Boolean))].sort();
  const legend = used.map((c) => `${c} = ${labels.get(c) ?? c}`).join("   ·   ");

  const last = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable;
  let y = (last?.finalY ?? 60) + 10;
  if (y > pageHeight - 26) {
    doc.addPage();
    header();
    y = 38;
  }
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(0, 0, 0);
  if (legend) {
    doc.text(doc.splitTextToSize(legend, pageWidth - margin * 2), margin, y);
    y += 8;
  }
  y += 6;
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.3);
  const rightX = pageWidth / 2 + 20;
  doc.line(margin, y, margin + 80, y);
  doc.line(rightX, y, rightX + 80, y);
  doc.setFontSize(8);
  doc.text("Ort, Datum", margin, y + 4);
  doc.text("Unterschrift Mitarbeiter", rightX, y + 4);

  // Seitenzahlen
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i += 1) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(0, 0, 0);
    doc.text(`Seite ${i} von ${pages}`, pageWidth - margin, pageHeight - 8, {
      align: "right",
    });
    doc.text(`Arbeitsnachweis · ${monthLabel}`, margin, pageHeight - 8);
  }

  const mm = String(ctx.month + 1).padStart(2, "0");
  doc.save(`Arbeitsnachweis_${slug(ctx.employeeName)}_${mm}_${ctx.year}.pdf`);
}
