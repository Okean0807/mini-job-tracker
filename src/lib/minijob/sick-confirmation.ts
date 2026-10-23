/**
 * O-2 Bestätigungen der Krankheitsfall-Neuberechnung und Herkunftsmerkmal neu
 * erfasster Krankheitstage (Owner DECISIONS R3 Punkte 1 und 4).
 *
 * Eine Bestätigung gilt für einen Monat UND genau die Änderung, die der Nutzer
 * dabei gesehen hat: die Menge der Krankheitstage, die nach der
 * Fortsetzungsregel jenseits von 42 Tagen liegen (Signatur). Ändert sich diese
 * Menge – durch Eingabe, Löschen, Backup-/CSV-Import oder einen Cloud-Stand –,
 * ist die Bestätigung nicht mehr aktuell: Sie wird verworfen, der Monat wird
 * wieder nach bisherigem Verhalten berechnet und erneut angeboten. Änderungen,
 * die die bestätigte Änderung nicht berühren (z. B. ein Arbeitseintrag nach der
 * Krankheit oder ein anderer Stundensatz), lassen die Bestätigung bestehen.
 */
import {
  SICK_RULE_CONTINUOUS,
  continuousSickCase,
  isSickLegacyDiscrepancy,
  monthKey,
  shiftPayroll,
} from "./payroll";
import type { AppData, Job, Settings, Shift, ShiftKind, SickConfirmation } from "./types";

export { SICK_RULE_CONTINUOUS };

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Herkunftsmerkmal beim Speichern eines Eintrags aus dem Dialog:
 * - kein Krankheitstag → kein Merkmal;
 * - neu angelegt oder bisher kein Krankheitstag (Art geändert) → markiert;
 * - bestehender Krankheitstag → gespeicherte Herkunft bleibt (aus
 *   "vergangen" wird beim Bearbeiten nie "neu").
 */
export function sickRuleForSave(
  kind: ShiftKind,
  previous: Pick<Shift, "kind" | "sickRule"> | undefined,
): Shift["sickRule"] {
  if (kind !== "krank") return undefined;
  if (!previous || previous.kind !== "krank") return SICK_RULE_CONTINUOUS;
  return previous.sickRule === SICK_RULE_CONTINUOUS ? SICK_RULE_CONTINUOUS : undefined;
}

/** FNV-1a 32 bit (hex) – deterministisch, nur zur Wiedererkennung, kein Schutz. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Signatur der Neuberechnung eines Monats: betroffene Krankheitstage (ohne
 * Bestätigung bezahlt, nach der Fortsetzungsregel jenseits von 42 Tagen) mit
 * ihrem vermuteten Fallbeginn. "" = im Monat gibt es nichts zu bestätigen.
 */
export function sickMonthSignature(month: string, shifts: Shift[], jobs: Job[]): string {
  const rows: string[] = [];
  for (const s of shifts) {
    if (s.kind !== "krank" || s.sickCaseId || monthKey(s.date) !== month) continue;
    const job = jobs.find((j) => j.id === s.jobId);
    const p = shiftPayroll(s, { job, history: shifts });
    if (!isSickLegacyDiscrepancy(p)) continue;
    rows.push(`${s.id}|${s.jobId ?? ""}|${s.date}|${continuousSickCase(s, job, shifts).start}`);
  }
  if (!rows.length) return "";
  rows.sort();
  return `${rows.length}:${fnv1a(`${month}\n${rows.join("\n")}`)}`;
}

/** Typprüfung (Import/Backup/Sync): nur {month: "YYYY-MM", signature: string}. */
export function sanitizeSickConfirmations(value: unknown): SickConfirmation[] {
  if (!Array.isArray(value)) return [];
  const byMonth = new Map<string, SickConfirmation>();
  for (const item of value) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
    const month = (item as { month?: unknown }).month;
    const signature = (item as { signature?: unknown }).signature;
    if (typeof month !== "string" || !MONTH_RE.test(month)) continue;
    if (typeof signature !== "string" || signature.length === 0) continue;
    if (!byMonth.has(month)) byMonth.set(month, { month, signature });
  }
  return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
}

/**
 * D5 (Owner R4): Monate, deren Bestätigung wegen geänderter Daten aufgehoben
 * wurde. Typprüfung: nur "YYYY-MM", sortiert, ohne Duplikate.
 */
export function sanitizeLapsedMonths(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const months = value.filter((m): m is string => typeof m === "string" && MONTH_RE.test(m));
  return [...new Set(months)].sort();
}

/** Nach erneuter Bestätigung: diese Monate aus der Aufgehoben-Liste entfernen. */
export function lapsedWithout(lapsed: unknown, months: readonly string[]): string[] {
  const done = new Set(months);
  return sanitizeLapsedMonths(lapsed).filter((m) => !done.has(m));
}

/** Monate gültig typisierter Bestätigungen (für Resolver und Exporte). */
export function confirmedSickMonths(
  settings: Pick<Settings, "sickContinuousConfirmations">,
): string[] {
  return sanitizeSickConfirmations(settings.sickContinuousConfirmations).map((c) => c.month);
}

/**
 * Bestätigung neuer Monate hinzufügen; bestehende Bestätigungen anderer Monate
 * bleiben unverändert erhalten (QA P3-R3-144-b).
 */
export function withSickConfirmations(
  existing: unknown,
  months: readonly string[],
  shifts: Shift[],
  jobs: Job[],
): SickConfirmation[] {
  const byMonth = new Map(sanitizeSickConfirmations(existing).map((c) => [c.month, c]));
  for (const month of months) {
    if (!MONTH_RE.test(month)) continue;
    const signature = sickMonthSignature(month, shifts, jobs);
    if (signature) byMonth.set(month, { month, signature });
  }
  return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
}

/** Nur Bestätigungen, deren Signatur zum aktuellen Datenstand passt. */
export function currentSickConfirmations(
  value: unknown,
  shifts: Shift[],
  jobs: Job[],
): SickConfirmation[] {
  return sanitizeSickConfirmations(value).filter(
    (c) => sickMonthSignature(c.month, shifts, jobs) === c.signature,
  );
}

function sameConfirmations(raw: unknown, list: SickConfirmation[]): boolean {
  if (!Array.isArray(raw) || raw.length !== list.length) return false;
  return list.every((c, i) => {
    const r = raw[i] as Partial<SickConfirmation> | null;
    return !!r && typeof r === "object" && r.month === c.month && r.signature === c.signature;
  });
}

/**
 * Nach jeder Datenänderung bzw. jedem Import (DECISIONS R3 Punkt 4):
 * ungültige oder nicht mehr aktuelle Bestätigungen entfernen. Nie still (D5):
 * jeder Monat, dessen Bestätigung aufgehoben wird, landet in
 * `settings.sickConfirmationsLapsed` und wird angezeigt, bis der Nutzer den
 * Hinweis schließt oder den Monat erneut bestätigt. `previous`
 * (letzter Stand) erlaubt, die Prüfung zu überspringen, wenn sich weder
 * Einträge, Jobs noch Bestätigungen geändert haben. Gibt dasselbe Objekt
 * zurück, wenn nichts zu ändern ist. Ein veraltetes Vorabversions-Feld
 * (`sickContinuousConfirmedMonths`, nie veröffentlicht, ohne Signatur) wird
 * verworfen.
 */
export function withCurrentSickConfirmations(data: AppData, previous?: AppData): AppData {
  const settingsRecord = data.settings as unknown as Record<string, unknown>;
  const legacy = "sickContinuousConfirmedMonths" in settingsRecord;
  const raw = settingsRecord["sickContinuousConfirmations"];
  if (raw === undefined && !legacy) return data;
  if (
    !legacy &&
    previous &&
    previous.shifts === data.shifts &&
    previous.jobs === data.jobs &&
    previous.settings.sickContinuousConfirmations === raw
  ) {
    return data;
  }
  const valid = currentSickConfirmations(raw, data.shifts, data.jobs);
  if (!legacy && sameConfirmations(raw, valid)) return data;
  const validMonths = new Set(valid.map((c) => c.month));
  const dropped = sanitizeSickConfirmations(raw)
    .map((c) => c.month)
    .filter((m) => !validMonths.has(m));
  // Unveröffentlichtes Vorabversions-Feld: dessen Monate ebenfalls melden.
  const legacyMonths = legacy
    ? sanitizeLapsedMonths(settingsRecord["sickContinuousConfirmedMonths"])
    : [];
  const lapsed = sanitizeLapsedMonths([
    ...sanitizeLapsedMonths(settingsRecord["sickConfirmationsLapsed"]),
    ...dropped,
    ...legacyMonths,
  ]);
  const settings = { ...settingsRecord };
  delete settings["sickContinuousConfirmedMonths"];
  if (valid.length) settings["sickContinuousConfirmations"] = valid;
  else delete settings["sickContinuousConfirmations"];
  if (lapsed.length) settings["sickConfirmationsLapsed"] = lapsed;
  else delete settings["sickConfirmationsLapsed"];
  return { ...data, settings: settings as unknown as Settings };
}

/**
 * Cloud-Wiederherstellung (QA P3-R3-144-e): lokale Bestätigungen gehen beim
 * Übernehmen eines fremden Gesamtstands nicht verloren. Vereinigung je Monat;
 * bei abweichender Signatur gewinnt die, die zum übernommenen Datenstand
 * passt. Nicht passende werden danach ohnehin verworfen (Prüfung in `commit`).
 */
export function mergeSickConfirmationsForRestore(
  remote: unknown,
  local: unknown,
  shifts: Shift[],
  jobs: Job[],
): SickConfirmation[] {
  const byMonth = new Map(sanitizeSickConfirmations(remote).map((c) => [c.month, c]));
  for (const c of sanitizeSickConfirmations(local)) {
    const current = byMonth.get(c.month);
    if (!current) {
      byMonth.set(c.month, c);
    } else if (current.signature !== c.signature) {
      if (sickMonthSignature(c.month, shifts, jobs) === c.signature) byMonth.set(c.month, c);
    }
  }
  return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
}
