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

/**
 * PDF Notiz Zeile 1: streetHouse + optional `, floor` + optional `, doorSide`.
 * Keine trailing/double commas; leer wenn nichts gesetzt.
 */
export function addressLine1(shift: Shift): string {
  const street = streetHouseLine(shift);
  const extras = [shift.floor, shift.doorSide]
    .map((part) => (part ?? "").trim())
    .filter(Boolean);
  if (!street && extras.length === 0) return "";
  if (!street) return extras.join(", ");
  return [street, ...extras].join(", ");
}

/** PDF Notiz Zeile 2: `zip city` (Leerzeichen); leer wenn beides fehlt. */
export function addressLine2(shift: Shift): string {
  return [shift.zip, shift.city]
    .map((part) => (part ?? "").trim())
    .filter(Boolean)
    .join(" ");
}

/** Leistungsart-Zelle: nur gespeichertes workCode (nie aus tasks/name). */
export function leistungsartCell(shift: Shift): string {
  return (shift.workCode ?? "").trim();
}

/** Platzhalter für Spalten ohne Wert (z. B. Krank/Urlaub ohne Zeiten). */
export const PROOF_EMPTY = "—";

/** Eintragsart-Zelle: abgeleitet aus Shift.kind, immer in Dokumentensprache. */
export function entryKindCell(shift: Pick<Shift, "kind">): string {
  return td(`kind.${shift.kind}`);
}

/** Nur Arbeitszeit zählt für die PDF-Summe — Abwesenheiten liefern keine Stunden. */
export function sumProofHours(shifts: Shift[]): number {
  return sumHours(shifts.filter((s) => s.kind === "arbeit"));
}

/**
 * Notiz-Zelle: Zeile1 Adresse, Zeile2 PLZ/Ort (kleiner im PDF), dann optionale Notiz.
 * Alte Schichten ohne floor/door/zip/city → nur Straße+Nr, keine Leerzeilen.
 */
export function noteCell(shift: Shift): string {
  const lines = [addressLine1(shift), addressLine2(shift)];
  const note = (shift.note ?? "").trim();
  if (note) lines.push(note);
  return lines.filter(Boolean).join("\n");
}

/** PDF-Tabellenkopf (7 Spalten): Einsatzort/Objekt ersetzt durch Eintragsart. */
export function proofTableHead(): string[] {
  return [
    td("label.date"),
    td("proof.entryKind"),
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
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.start.localeCompare(b.start) ||
      a.id.localeCompare(b.id),
  );
}

/**
 * Gemeinsame PDF-Zeilen für Arbeitsnachweis / Leistungsnachweis.
 * Spalten: Datum | Eintragsart | Beginn | Ende | Stunden | Leistungsart | Notiz
 * Nur „Arbeit“ zeigt Zeiten, Stunden und Leistungsart — sonst „—“,
 * damit Krank/Urlaub/Frei/Feiertag keine Arbeitsleistung suggerieren.
 * Adresse (und optional die Benutzer-Notiz) stehen in der Notiz-Spalte.
 */
export function buildProofTableRows(shifts: Shift[]): string[][] {
  return sortProofShifts(shifts).map((s) => {
    const isWork = s.kind === "arbeit";
    return [
      formatProofDate(s.date),
      entryKindCell(s),
      isWork ? s.start : PROOF_EMPTY,
      isWork ? s.end : PROOF_EMPTY,
      isWork ? formatHours(shiftHours(s), DOCUMENT_LOCALE) : PROOF_EMPTY,
      (isWork ? leistungsartCell(s) : "") || PROOF_EMPTY,
      noteCell(s) || PROOF_EMPTY,
    ];
  });
}

/** Export-Zeitstempel für Header „Ausgefüllt am“. */
export function filledAtLabel(now = new Date()): string {
  return formatProofDate(now.toISOString());
}

/** Dynamische Leistungsart-Spaltenbreite (mm) aus Header + Werten. */
export function computeLeistungsartColWidth(
  doc: jsPDF,
  shifts: Shift[],
  header: string,
  opts?: { minMm?: number; maxMm?: number; padMm?: number },
): number {
  const minMm = opts?.minMm ?? 12;
  const maxMm = opts?.maxMm ?? 28;
  const padMm = opts?.padMm ?? 2;
  const values = [header, ...shifts.map((s) => leistungsartCell(s) || "—")];
  let maxW = 0;
  for (const value of values) {
    maxW = Math.max(maxW, doc.getTextWidth(value));
  }
  return Math.min(maxMm, Math.max(minMm, maxW + padMm));
}

const NOTE_COL_INDEX = 6;

type AutoTableCellHookData = {
  section: string;
  column: { index: number };
  row: { index: number };
  cell: {
    raw?: unknown;
    text?: string | string[];
    x: number;
    y: number;
    width: number;
    height: number;
    padding: (side: "left" | "top" | "right" | "bottom") => number;
    styles: { minCellHeight?: number };
  };
  doc: jsPDF;
};

/**
 * autoTable-Hooks für die Notiz-Spalte: PLZ/Ort-Zeile (~1.5pt kleiner).
 * `line2ByRow` muss parallel zu `sortProofShifts(shifts)` / buildProofTableRows laufen.
 */
export function proofNoteFontHooks(baseFontSize: number, line2ByRow: string[]) {
  const line2Size = Math.max(5, baseFontSize - 1.5);
  return {
    didParseCell(data: AutoTableCellHookData) {
      if (data.section !== "body" || data.column.index !== NOTE_COL_INDEX) return;
      const raw = Array.isArray(data.cell.text)
        ? data.cell.text.join("\n")
        : String(data.cell.text ?? data.cell.raw ?? "");
      (data.cell as { _proofNote?: string })._proofNote = raw;
      const line2 = line2ByRow[data.row.index] ?? "";
      (data.cell as { _proofNoteLine2?: string })._proofNoteLine2 = line2;

      // Clear early for layout; willDrawCell clears again immediately before autoTable paint.
      data.cell.text = [""];

      const lines = raw.split("\n").filter((l) => l.length > 0);
      if (lines.length === 0) return;

      const line2Trim = line2.trim();
      // Match didDrawCell vertical rhythm so row height stays correct without painted text.
      let contentMm = baseFontSize * 0.35;
      for (const line of lines) {
        const size = line2Trim && line.trim() === line2Trim ? line2Size : baseFontSize;
        contentMm += size * 0.45;
      }
      const minH = data.cell.padding("top") + data.cell.padding("bottom") + contentMm;
      data.cell.styles.minCellHeight = Math.max(data.cell.styles.minCellHeight ?? 0, minH);
    },
    /** autoTable paints cell.text right after this hook — clear so only didDrawCell draws. */
    willDrawCell(data: AutoTableCellHookData) {
      if (data.section !== "body" || data.column.index !== NOTE_COL_INDEX) return;
      data.cell.text = [];
    },
    didDrawCell(data: AutoTableCellHookData) {
      if (data.section !== "body" || data.column.index !== NOTE_COL_INDEX) return;
      const raw = (data.cell as { _proofNote?: string })._proofNote ?? "";
      if (!raw) return;
      const lines = raw.split("\n").filter((l) => l.length > 0);
      if (lines.length === 0) return;

      const line2 = (data.cell as { _proofNoteLine2?: string })._proofNoteLine2 ?? "";
      const line2Trim = line2.trim();
      const doc = data.doc;
      const padL = data.cell.padding("left");
      const padT = data.cell.padding("top");
      const x = data.cell.x + padL;
      const maxW = Math.max(4, data.cell.width - padL - data.cell.padding("right"));

      doc.setFillColor(255, 255, 255);
      doc.rect(
        data.cell.x + 0.15,
        data.cell.y + 0.15,
        data.cell.width - 0.3,
        data.cell.height - 0.3,
        "F",
      );
      doc.setTextColor(0, 0, 0);
      doc.setFont("helvetica", "normal");

      let y = data.cell.y + padT + baseFontSize * 0.35;
      for (const line of lines) {
        const size = line2Trim && line.trim() === line2Trim ? line2Size : baseFontSize;
        doc.setFontSize(size);
        const wrapped = doc.splitTextToSize(line, maxW) as string[];
        for (const w of wrapped) {
          doc.text(w, x, y);
          y += size * 0.45;
        }
      }
    },
  };
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
    entryKind: td("proof.entryKind"),
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
  const totalHours = sumProofHours(list);
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

  const head = proofTableHead();
  const leistungsartWidth = computeLeistungsartColWidth(doc, list, head[5] ?? L.workCode, {
    minMm: 12,
    maxMm: 28,
  });
  const noteLine2ByRow = list.map((s) => addressLine2(s));
  const noteHooks = proofNoteFontHooks(6.5, noteLine2ByRow);

  autoTable(doc, {
    startY: 37,
    margin: { left: margin, right: margin, top: 37, bottom: 14 },
    theme: "grid",
    head: [head],
    body: buildProofTableRows(list),
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
      // Eintragsart: „Feiertag“/„Sonstige“ müssen ungekürzt passen.
      1: { cellWidth: 20 },
      2: { cellWidth: 12, halign: "center" },
      3: { cellWidth: 12, halign: "center" },
      4: { cellWidth: 16, halign: "right" },
      5: { cellWidth: leistungsartWidth, overflow: "linebreak" },
      6: { cellWidth: "auto" },
    },
    rowPageBreak: "avoid",
    showHead: "everyPage",
    showFoot: "lastPage",
    didParseCell: noteHooks.didParseCell,
    willDrawCell: noteHooks.willDrawCell,
    didDrawCell: noteHooks.didDrawCell,
    didDrawPage: () => {
      header();
    },
  });

  // Legende: Schicht-Snapshot vor aktuellem Katalog, vor Builtin.
  const labels = new Map<string, string>(Object.entries(WORK_CODE_LABELS));
  (ctx.customCodes ?? []).forEach((c) => labels.set(c.code, c.label));
  const used = [...new Set(list.map((s) => (s.workCode ?? "").trim()).filter(Boolean))].sort();
  const legend = used
    .map((c) => {
      const snapshot = list.find(
        (s) => (s.workCode ?? "").trim() === c && (s.workCodeLabel ?? "").trim(),
      );
      const label = (snapshot?.workCodeLabel ?? "").trim() || labels.get(c) || c;
      return `${c} = ${label}`;
    })
    .join("   ·   ");

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
