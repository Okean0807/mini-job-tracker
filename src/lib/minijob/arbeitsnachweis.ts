import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

import { td, DOCUMENT_LOCALE } from "./document-i18n";

import { formatHours, monthNames, shiftHours, sumHours } from "./calc";
import { saveAndRegisterBytes } from "./generated-docs";
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

/** ISO-Datum → DD.MM.YYYY für PDF-Dokumente. */
export function formatProofDate(date: string | undefined): string {
  if (!date) return "";
  const [y, m, d] = date.slice(0, 10).split("-");
  if (!y || !m || !d) return "";
  return `${d}.${m}.${y}`;
}

/** Kompakte Adresszeile: „Musterstraße 15, 12345 Berlin, 3. OG, links“. */
export function addressLine(shift: Shift, jobs: Job[] = []): string {
  const street = [shift.street, shift.houseNo]
    .map((part) => (part ?? "").trim())
    .filter(Boolean)
    .join(" ");
  const locality = [shift.zip, shift.city]
    .map((part) => (part ?? "").trim())
    .filter(Boolean)
    .join(" ");
  const place =
    [street, locality].filter(Boolean).join(", ") ||
    shift.workplace ||
    jobs.find((j) => j.id === shift.jobId)?.name ||
    "";
  return [place, shift.floor, shift.doorSide]
    .map((part) => (part ?? "").trim())
    .filter(Boolean)
    .join(", ");
}

/** Nur Straße + Hausnummer (ohne PLZ/Ort) — Liste & Notiz-Spalte. */
export function streetHouseLine(shift: Shift): string {
  return [shift.street, shift.houseNo]
    .map((part) => (part ?? "").trim())
    .filter(Boolean)
    .join(" ");
}

/** Leistungsart-Zelle: nur gespeichertes workCode (nie aus tasks/name). */
export function leistungsartCell(shift: Shift): string {
  return (shift.workCode ?? "").trim();
}

/** Notiz-Zelle: Straße+Nr, Ort, Etage, Türseite und optionale Notiz. */
export function noteCell(shift: Shift): string {
  return [streetHouseLine(shift), shift.city, shift.floor, shift.doorSide, shift.note]
    .map((part) => (part ?? "").trim())
    .filter(Boolean)
    .join("\n");
}

/** PDF-Tabellenkopf (7 Spalten, §7). */
export function proofTableHead(): string[] {
  return [
    td("label.date"),
    td("worklog.workplace"),
    td("label.start"),
    td("label.end"),
    td("label.hours"),
    td("worklog.workCode"),
    td("label.note"),
  ];
}

/** Sortiert PDF-Einträge chronologisch, ohne die gespeicherten Schichten zu verändern. */
export function sortProofShifts(shifts: Shift[]): Shift[] {
  return [...shifts].sort(
    (a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start),
  );
}

/**
 * Gemeinsame PDF-Zeilen für Arbeitsnachweis / Leistungsnachweis.
 * Spalten: Datum | Einsatzort/Objekt | Beginn | Ende | Stunden | Leistungsart | Notiz
 * Leistungsart leer → "—"; Notiz leer wenn keine Adresse/Notiz.
 */
export function buildProofTableRows(shifts: Shift[], jobs: Job[] = []): string[][] {
  return sortProofShifts(shifts).map((s) => {
    const jobName = jobs.find((j) => j.id === s.jobId)?.name;
    const einsatzort = (s.workplace ?? jobName ?? "").trim() || "—";
    const leistungsart = leistungsartCell(s) || "—";
    return [
      formatProofDate(s.date),
      einsatzort,
      s.start,
      s.end,
      formatHours(shiftHours(s), DOCUMENT_LOCALE),
      leistungsart,
      noteCell(s),
    ];
  });
}

/** Export-Zeitstempel für Header „Ausgefüllt am“. */
export function filledAtLabel(now = new Date()): string {
  return formatProofDate(now.toISOString());
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

/** Collect localized Arbeitsnachweis strings (for tests + PDF). */
export function arbeitsnachweisLabels() {
  return {
    title: td("proof.title"),
    employee: td("proof.employee"),
    month: td("label.month"),
    employer: td("label.employer"),
    date: td("label.date"),
    start: td("label.start"),
    break: td("label.break"),
    end: td("label.end"),
    workHours: td("proof.workHours"),
    workCode: td("worklog.workCode"),
    note: td("label.note"),
    filledAt: td("proof.filledAt"),
    totalHours: td("proof.totalHours"),
    placeDate: td("proof.placeDate"),
    signEmployee: td("proof.signEmployee"),
    pageOf: (page: number, pages: number) => td("proof.pageOf", { page, pages }),
    minutes: td("label.minutes"),
  };
}

/** DATEV-inspirierter Arbeitsnachweis: A4 hoch, Schwarz-Weiß, druckfertig. */
export function exportArbeitsnachweisPdf(shifts: Shift[], ctx: ArbeitsnachweisContext) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 12;
  const months = monthNames(DOCUMENT_LOCALE);
  const monthName = months[ctx.month] ?? "";
  const monthLabel = `${monthName} ${ctx.year}`;
  const list = sortProofShifts(shifts);
  const totalHours = sumHours(list);
  const L = arbeitsnachweisLabels();
  // Export time for header — not shift.date / createdAt
  const filledAt = filledAtLabel();

  const header = () => {
    doc.setTextColor(0, 0, 0);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text(L.title, margin, 14);

    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    const col2 = margin + 62;
    const col3 = margin + 124;
    doc.setTextColor(80, 80, 80);
    doc.text(`${L.employee}:`, margin, 20);
    doc.text(`${L.month}:`, col2, 20);
    doc.text(`${L.employer}:`, col3, 20);
    doc.setTextColor(0, 0, 0);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.text(ctx.employeeName || "—", margin, 25);
    doc.text(monthLabel, col2, 25);
    doc.text(ctx.employer || "—", col3, 25);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(80, 80, 80);
    doc.text(`${L.filledAt}: ${filledAt}`, margin, 30);
    doc.setTextColor(0, 0, 0);

    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.4);
    doc.line(margin, 33, pageWidth - margin, 33);
  };

  autoTable(doc, {
    startY: 37,
    margin: { left: margin, right: margin, top: 37, bottom: 14 },
    theme: "grid",
    head: [proofTableHead()],
    body: buildProofTableRows(list, ctx.jobs),
    foot: [
      [
        { content: `${L.totalHours}:`, colSpan: 4, styles: { halign: "right" as const } },
        { content: formatHours(totalHours, DOCUMENT_LOCALE), styles: { halign: "right" as const } },
        "",
        "",
      ],
    ],
    styles: {
      font: "helvetica",
      fontSize: 6.5,
      cellPadding: { top: 0.5, bottom: 0.5, left: 1.2, right: 1.2 },
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
      fontSize: 6.5,
      lineWidth: 0.3,
      halign: "left",
      overflow: "visible",
    },
    footStyles: {
      fillColor: [225, 225, 225],
      textColor: [0, 0, 0],
      fontStyle: "bold",
      fontSize: 8,
      lineWidth: 0.4,
    },
    columnStyles: {
      0: { cellWidth: 17 },
      1: { cellWidth: 28 },
      2: { cellWidth: 12, halign: "center" },
      3: { cellWidth: 12, halign: "center" },
      4: { cellWidth: 16, halign: "right" },
      5: { cellWidth: 14 },
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
  let y = (last?.finalY ?? 60) + 8;
  if (y > pageHeight - 32) {
    doc.addPage();
    header();
    y = 40;
  }
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(0, 0, 0);
  if (legend) {
    const lines = doc.splitTextToSize(legend, pageWidth - margin * 2);
    doc.text(lines, margin, y);
    y += lines.length * 3.4 + 6;
  }
  y += 8;
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.3);
  const colWidth = (pageWidth - margin * 2 - 16) / 2;
  const rightX = margin + colWidth + 16;
  doc.line(margin, y, margin + colWidth, y);
  doc.line(rightX, y, rightX + colWidth, y);
  doc.setFontSize(8);
  doc.text(L.placeDate, margin, y + 4);
  doc.text(L.signEmployee, rightX, y + 4);

  // Seitenzahlen
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i += 1) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(0, 0, 0);
    doc.text(L.pageOf(i, pages), pageWidth - margin, pageHeight - 7, {
      align: "right",
    });
    doc.text(`${L.title} · ${monthLabel}`, margin, pageHeight - 7);
  }

  const safeMonth = monthName.replace(/\s+/g, "_") || String(ctx.month + 1);
  const filename = `${td("proof.fileName")}_${safeMonth}_${ctx.year}.pdf`;
  const buffer = doc.output("arraybuffer") as ArrayBuffer;
  saveAndRegisterBytes({
    bytes: buffer,
    filename,
    category: "arbeitsnachweis",
    mimeType: "application/pdf",
  });
}
