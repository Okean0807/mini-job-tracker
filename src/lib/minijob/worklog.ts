import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

import { t, type TFunction } from "@/lib/i18n";
import { td, DOCUMENT_LOCALE } from "./document-i18n";

import { formatDate, formatHours, sumHours } from "./calc";
import {
  buildProofTableRows,
  filledAtLabel,
  proofTableHead,
} from "./arbeitsnachweis";
import { saveAndRegisterBytes } from "./generated-docs";
import type { Job, Shift } from "./types";

const TEAL: [number, number, number] = [16, 122, 110];
const GREY: [number, number, number] = [120, 120, 120];

/** Vordefinierte Reinigungs-Tätigkeiten (Schlüssel, lokalisiert über task.*). */
export const CLEANING_TASKS = [
  "maintenance",
  "deep",
  "vacuum",
  "mopping",
  "sanitary",
  "waste",
  "windows",
  "kitchen",
  "surfaces",
  "stairs",
  "disinfect",
  "supplies",
  "floorcare",
  "special",
] as const;

export type CleaningTask = (typeof CLEANING_TASKS)[number];

/** Vorlagen werden als "#key" gespeichert, freier Text unverändert. */
export function templateValue(key: string): string {
  return `#${key}`;
}

export function taskLabel(task: string, translate: TFunction = t): string {
  return task.startsWith("#") ? translate(`task.${task.slice(1)}`) : task;
}

export function taskListLabel(tasks: string[] | undefined, translate: TFunction = t): string {
  return (tasks ?? []).map((task) => taskLabel(task, translate)).join(", ");
}

/** Bild auf Maximalbreite verkleinern und als JPEG-DataURL zurückgeben. */
export async function compressPhoto(file: File, max = 900, quality = 0.6): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", quality);
}

export async function currentPosition(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("unsupported"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  });
}

export function formatGps(gps: { lat: number; lng: number }): string {
  return `${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}`;
}

export interface WorkReportContext {
  jobs: Job[];
  month: string;
  employeeName?: string;
  includePhotos: boolean;
}

/** Monatlicher Leistungsnachweis als PDF. */
export function exportWorkReportPdf(shifts: Shift[], ctx: WorkReportContext) {
  const doc = new jsPDF();
  const list = [...shifts].sort((a, b) => (a.date > b.date ? 1 : -1));

  doc.setFontSize(17);
  doc.setTextColor(...TEAL);
  doc.text(td("worklog.pdfTitle"), 14, 18);
  doc.setFontSize(11);
  doc.setTextColor(20, 20, 20);
  doc.text(ctx.month, 14, 26);
  doc.setFontSize(8);
  doc.setTextColor(...GREY);
  const jobNames = [...new Set(list.map((s) => ctx.jobs.find((j) => j.id === s.jobId)?.name))]
    .filter(Boolean)
    .join(", ");
  doc.text([ctx.employeeName, jobNames].filter(Boolean).join(" · ") || td("app.name"), 14, 31);
  doc.text(`${td("proof.filledAt")}: ${filledAtLabel()}`, 14, 36);

  autoTable(doc, {
    startY: 41,
    head: [proofTableHead()],
    body: buildProofTableRows(list, ctx.jobs),
    foot: [[td("label.total"), "", "", "", formatHours(sumHours(list), DOCUMENT_LOCALE), "", ""]],
    styles: { fontSize: 8, cellPadding: 2, valign: "top" },
    columnStyles: {
      0: { cellWidth: 22 },
      1: { cellWidth: 32 },
      2: { cellWidth: 14 },
      3: { cellWidth: 14 },
      4: { cellWidth: 18 },
      5: { cellWidth: 24 },
      6: { cellWidth: 40 },
    },
    headStyles: { fillColor: TEAL },
    footStyles: { fillColor: [230, 230, 230], textColor: 20, fontStyle: "bold" },
  });

  const after = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable;
  let y = (after?.finalY ?? 40) + 16;
  if (y > 250) {
    doc.addPage();
    y = 30;
  }
  doc.setDrawColor(160, 160, 160);
  doc.line(14, y, 84, y);
  doc.line(110, y, 190, y);
  doc.setFontSize(8);
  doc.setTextColor(...GREY);
  doc.text(td("worklog.signEmployee"), 14, y + 5);
  doc.text(td("worklog.signEmployer"), 110, y + 5);

  if (ctx.includePhotos) {
    const photos = list.flatMap((s) =>
      (s.photos ?? []).map((data) => ({ data, date: s.date, place: s.workplace })),
    );
    if (photos.length > 0) {
      doc.addPage();
      doc.setFontSize(12);
      doc.setTextColor(20, 20, 20);
      doc.text(td("worklog.photos"), 14, 20);
      let px = 14;
      let py = 28;
      photos.forEach((photo) => {
        if (py > 240) {
          doc.addPage();
          py = 20;
          px = 14;
        }
        try {
          doc.addImage(photo.data, "JPEG", px, py, 85, 60);
        } catch {
          /* ungültiges Bild überspringen */
        }
        doc.setFontSize(7);
        doc.setTextColor(...GREY);
        doc.text([formatDate(photo.date, DOCUMENT_LOCALE), photo.place].filter(Boolean).join(" · "), px, py + 64);
        if (px === 14) {
          px = 110;
        } else {
          px = 14;
          py += 70;
        }
      });
    }
  }

  const filename = `${td("worklog.fileName")}-${ctx.month}.pdf`.replace(/\s+/g, "-");
  const buffer = doc.output("arraybuffer") as ArrayBuffer;
  saveAndRegisterBytes({
    bytes: buffer,
    filename,
    category: "worklog",
    mimeType: "application/pdf",
  });
}

