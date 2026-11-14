/**
 * Anzeigeformate des Eintrag-Editors.
 *
 * Reine Funktionen, damit die deutsche Darstellung (7 Std. 30 Min., 13,50 €)
 * unabhängig von React getestet werden kann. Rechenlogik bleibt in calc.ts.
 */

export interface DurationLabels {
  hour: string;
  minute: string;
}

/** Dezimalstunden → ganze Stunden + Restminuten (auf die Minute gerundet). */
export function splitHoursMinutes(value: number): { hours: number; minutes: number } {
  const total = Math.max(0, Math.round((Number.isFinite(value) ? value : 0) * 60));
  return { hours: Math.floor(total / 60), minutes: total % 60 };
}

/** 7,5 → "7 Std. 30 Min.", 0,75 → "45 Min.", 8 → "8 Std." */
export function formatWorkDuration(value: number, labels: DurationLabels): string {
  const { hours, minutes } = splitHoursMinutes(value);
  if (hours === 0) return `${minutes} ${labels.minute}`;
  if (minutes === 0) return `${hours} ${labels.hour}`;
  return `${hours} ${labels.hour} ${minutes} ${labels.minute}`;
}

/**
 * Stundenlohn für das Eingabefeld: deutsches Komma, zwei Nachkommastellen.
 * undefined (kein Satz gesetzt) bleibt leer, 0 bleibt "0,00".
 */
export function formatRateInput(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  return value.toFixed(2).replace(".", ",");
}

/**
 * Tastatureingabe auf Ziffern und ein Dezimaltrennzeichen begrenzen.
 * K1: Nachkommastellen werden hier NICHT abgeschnitten ("12,345" bleibt "12,345") – gerundet wird
 * erst beim Verlassen des Felds bzw. Speichern (parseEditedRateInput), nie stillschweigend gekürzt.
 */
export function sanitizeRateInput(raw: string): string {
  const cleaned = raw.replace(/[^\d.,]/g, "").replace(/\./g, ",");
  const [head, ...rest] = cleaned.split(",");
  if (rest.length === 0) return head ?? "";
  return `${head},${rest.join("")}`;
}

/**
 * K1: Hat der Satz mehr Genauigkeit, als das Feld zeigt (zwei Nachkommastellen)?
 * 12.345 -> true (Feld zeigt "12,35"), 13.9 / 15.5 / 14 -> false.
 */
export function hasHiddenRatePrecision(value: number | undefined): value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  return Number(value.toFixed(2)) !== value;
}

/** K1: Exakter Satz als Betrag in Landesschreibweise, ohne Rundung: 12.345 -> "12,345 €". */
export function formatExactRate(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 20,
  }).format(value);
}

export interface ExtrasSummaryInput {
  photos: number;
  gps: boolean;
  note: boolean;
  overtime: boolean;
}

export interface ExtrasSummaryLabels {
  photos: (count: number) => string;
  gps: string;
  note: string;
  overtime: string;
}

/** "Fotos 2 · Standort gespeichert · Notiz vorhanden" für „Weitere Angaben“. */
export function extrasSummaryParts(
  input: ExtrasSummaryInput,
  labels: ExtrasSummaryLabels,
): string[] {
  const parts: string[] = [];
  if (input.photos > 0) parts.push(labels.photos(input.photos));
  if (input.gps) parts.push(labels.gps);
  if (input.note) parts.push(labels.note);
  if (input.overtime) parts.push(labels.overtime);
  return parts;
}
