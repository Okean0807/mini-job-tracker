/**
 * Prüfungen des Eintrags-Editors (Paket A, "Required validation").
 *
 * Reine Funktion: sie liest den Entwurf und den Bestand und gibt Befunde als CODES zurück
 * (Texte liegen im Editor / in der i18n). Der **Rechenkern bleibt unverändert** – hier wird
 * nichts umgerechnet, sondern nur benannt, was `calc.shiftHours` sonst still verschluckt:
 *
 * - `zero-duration`   Beginn = Ende ⇒ 0 Minuten (bisher ohne Hinweis gespeichert)
 * - `break-too-long`  Pause ≥ Arbeitszeit ⇒ `shiftHours` klemmt auf 0 (bisher ohne Hinweis)
 *
 * Schweregrade:
 * - `errors`   Speichern blockiert (unmöglicher Eintrag)
 * - `warnings` Speichern erst nach ausdrücklicher Bestätigung (verdächtig, aber möglich)
 * - `infos`    nur Hinweis (z. B. Ende am Folgetag, Zeitumstellung)
 *
 * Eine legitime Nachtschicht wird NIE abgelehnt: `end < start` ist eine Information, und nur
 * eine daraus folgende Dauer über 12 Stunden gilt als verdächtig (Tippfehler-Verdacht).
 * Abwesenheiten (Urlaub/Krank/…) werden nicht geprüft: ihre Zeiten stammen aus dem Wochenplan.
 *
 * Altbestand (F1): Ein BESTEHENDER Arbeitseintrag, der schon so gespeichert war (Dauer 0 oder
 * Pause ≥ Arbeitszeit), bleibt speicherbar, solange Beginn, Ende und Pause unverändert sind –
 * sonst ließe sich z. B. nicht einmal die Notiz ändern. Gemeldet wird das als Hinweis
 * (`legacy-zero-duration`, `legacy-break-too-long`). Sobald Beginn, Ende oder Pause geändert
 * werden, gilt wieder die strenge Prüfung; ein neuer Eintrag wird immer streng geprüft. Die
 * gespeicherten Werte werden dabei nie verändert – die Prüfung liest nur.
 */
import { toMinutes } from "./calc";
import {
  absoluteRange,
  DAY_MINUTES,
  dayIndex,
  isoFromDayIndex,
  isTimeValue,
  shiftEndMinutes,
} from "./entry-suggest";
import type { Shift, ShiftKind } from "./types";

export type EntryIssueCode =
  | "start-missing"
  | "end-missing"
  | "invalid-start"
  | "invalid-end"
  | "zero-duration"
  | "break-too-long"
  | "overlap"
  | "duplicate"
  | "overnight-long"
  | "ends-next-day"
  | "dst-transition"
  | "legacy-zero-duration"
  | "legacy-break-too-long";

export type EntryIssueField = "start" | "end" | "break";

export interface EntryIssue {
  code: EntryIssueCode;
  /** Feld, an dem der Befund angezeigt wird. */
  field?: EntryIssueField;
  /** Platzhalterwerte für die Meldung (z. B. Zeiten des kollidierenden Eintrags). */
  vars?: Record<string, string | number>;
}

export interface EntryValidation {
  errors: EntryIssue[];
  warnings: EntryIssue[];
  infos: EntryIssue[];
}

export interface EntryDraft {
  /** Id des bearbeiteten Eintrags (wird bei allen Vergleichen ausgeschlossen). */
  id?: string | null;
  kind: ShiftKind;
  jobId?: string;
  date: string;
  start: string;
  end: string;
  breakMinutes: number;
  rate?: number;
  note?: string;
}

export const EMPTY_VALIDATION: EntryValidation = { errors: [], warnings: [], infos: [] };

/** Ab dieser Brutto-Dauer gilt ein Eintrag mit Ende vor Beginn als Tippfehler-Verdacht. */
export const OVERNIGHT_WARN_MINUTES = 12 * 60;

/**
 * Dublettenschlüssel desselben Zuschnitts wie beim CSV-Import (`csv.shiftImportKey`), aber
 * über die stabile `jobId` statt über den Jobnamen: innerhalb der App sind Ids eindeutig.
 */
function duplicateKey(
  shift: Pick<
    Shift,
    "date" | "start" | "end" | "breakMinutes" | "rate" | "jobId" | "kind" | "note"
  >,
): string {
  return [
    shift.date,
    shift.start,
    shift.end,
    String(shift.breakMinutes ?? 0),
    typeof shift.rate === "number" ? String(shift.rate) : "",
    shift.jobId ?? "",
    shift.kind,
    shift.note?.trim() ?? "",
  ].join("|");
}

/* ------------------------------------------------------------------ Zeitumstellung (Hinweis) */

const APP_TIME_ZONE = "Europe/Berlin";

function berlinOffsetMinutesAtNoon(dayIdx: number): number | null {
  try {
    const utcMs = dayIdx * 86_400_000 + 12 * 3_600_000;
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: APP_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date(utcMs));
    const pick = (type: string): number => {
      const raw = parts.find((p) => p.type === type)?.value;
      const value = Number(raw);
      return Number.isFinite(value) ? value : Number.NaN;
    };
    const year = pick("year");
    const month = pick("month");
    const day = pick("day");
    const hour = pick("hour") % 24; // manche ICU-Fassungen liefern "24" für Mitternacht
    const minute = pick("minute");
    if (![year, month, day, hour, minute].every(Number.isFinite)) return null;
    const localMs = Date.UTC(year, month - 1, day, hour, minute);
    return Math.round((localMs - utcMs) / 60_000);
  } catch {
    return null;
  }
}

/**
 * Minute (lokal, seit Mitternacht), zu der an diesem Tag die Uhr umgestellt wird – sonst `null`.
 * Deutschland: Ende März 02:00 → 03:00, Ende Oktober 03:00 → 02:00.
 */
export function dstTransitionMinute(dateIso: string): number | null {
  const index = dayIndex(dateIso);
  if (!Number.isFinite(index)) return null;
  const previous = berlinOffsetMinutesAtNoon(index - 1);
  const current = berlinOffsetMinutesAtNoon(index);
  if (previous === null || current === null || previous === current) return null;
  return current > previous ? 120 : 180;
}

/* ------------------------------------------------------------------ Altbestand (F1) */

/** Gespeicherte Fassung des bearbeiteten Eintrags – nur die Felder, auf die es ankommt. */
export type StoredEntryTimes = Pick<Shift, "id" | "kind" | "start" | "end" | "breakMinutes">;

/**
 * Darf eine schon gespeicherte Kombination aus Dauer und Pause unverändert bleiben?
 * Nur für einen BESTEHENDEN Arbeitseintrag (gleiche Id, schon als Arbeit gespeichert), dessen
 * Beginn, Ende und Pause exakt den gespeicherten Werten entsprechen.
 */
function isUnchangedStoredEntry(
  draft: EntryDraft,
  original: StoredEntryTimes | undefined,
  times: { start: string; end: string; breakMinutes: number },
): boolean {
  if (!draft.id || !original || original.id !== draft.id) return false;
  if (original.kind !== "arbeit") return false;
  return (
    (original.start ?? "").trim() === times.start &&
    (original.end ?? "").trim() === times.end &&
    Math.max(0, Math.round(original.breakMinutes || 0)) === times.breakMinutes
  );
}

/* ------------------------------------------------------------------ Hauptprüfung */

export function validateEntry(
  draft: EntryDraft,
  options: {
    shifts?: readonly Shift[];
    /** Gespeicherte Fassung des bearbeiteten Eintrags (nur beim Bearbeiten, F1). */
    original?: StoredEntryTimes;
  } = {},
): EntryValidation {
  const errors: EntryIssue[] = [];
  const warnings: EntryIssue[] = [];
  const infos: EntryIssue[] = [];
  // Abwesenheiten behalten ihr bisheriges Verhalten (Zeiten kommen aus dem Wochenplan).
  if (draft.kind !== "arbeit") return { errors, warnings, infos };

  const startRaw = (draft.start ?? "").trim();
  const endRaw = (draft.end ?? "").trim();
  if (!startRaw) errors.push({ code: "start-missing", field: "start" });
  else if (!isTimeValue(startRaw)) errors.push({ code: "invalid-start", field: "start" });
  if (!endRaw) errors.push({ code: "end-missing", field: "end" });
  else if (!isTimeValue(endRaw)) errors.push({ code: "invalid-end", field: "end" });
  if (errors.length > 0) return { errors, warnings, infos };

  const startMin = toMinutes(startRaw);
  const endMin = toMinutes(endRaw);
  const endAbs = shiftEndMinutes({ start: startRaw, end: endRaw });
  const gross = endAbs - startMin;
  const breakMinutes = Math.max(0, Math.round(draft.breakMinutes || 0));

  // F1: Eine schon so gespeicherte Kombination bleibt unverändert speicherbar (Hinweis statt
  // Sperre); jede Änderung an Beginn, Ende oder Pause wird wieder streng geprüft.
  const keepsStoredCombination = isUnchangedStoredEntry(draft, options.original, {
    start: startRaw,
    end: endRaw,
    breakMinutes,
  });
  if (gross <= 0) {
    if (!keepsStoredCombination) {
      errors.push({ code: "zero-duration", field: "end" });
      return { errors, warnings, infos };
    }
    infos.push({ code: "legacy-zero-duration" });
  } else if (breakMinutes >= gross) {
    if (!keepsStoredCombination) {
      errors.push({
        code: "break-too-long",
        field: "break",
        vars: { break: breakMinutes, gross },
      });
      return { errors, warnings, infos };
    }
    infos.push({ code: "legacy-break-too-long" });
  }

  const crossesMidnight = endMin < startMin;
  if (crossesMidnight) {
    infos.push({ code: "ends-next-day", vars: { minutes: gross } });
    if (gross > OVERNIGHT_WARN_MINUTES) {
      warnings.push({ code: "overnight-long", vars: { minutes: gross } });
    }
  }

  // Zeitumstellung: nur ein Hinweis. Gerechnet wird weiter mit Uhrzeiten (unveränderter Kern).
  const sameDayTransition = dstTransitionMinute(draft.date);
  if (sameDayTransition !== null && startMin < sameDayTransition && endAbs > sameDayTransition) {
    infos.push({ code: "dst-transition" });
  } else if (crossesMidnight) {
    const index = dayIndex(draft.date);
    const nextDay = Number.isFinite(index) ? dstTransitionMinute(isoFromDayIndex(index + 1)) : null;
    if (nextDay !== null && endAbs > DAY_MINUTES + nextDay) {
      infos.push({ code: "dst-transition" });
    }
  }

  const shifts = options.shifts ?? [];
  const own = absoluteRange({ date: draft.date, start: startRaw, end: endRaw });
  const ownKey = duplicateKey({
    date: draft.date,
    start: startRaw,
    end: endRaw,
    breakMinutes,
    kind: draft.kind,
    ...(draft.rate !== undefined ? { rate: draft.rate } : {}),
    ...(draft.jobId !== undefined ? { jobId: draft.jobId } : {}),
    ...(draft.note !== undefined ? { note: draft.note } : {}),
  });

  let overlap: Shift | null = null;
  let duplicate = false;
  for (const shift of shifts) {
    if (draft.id && shift.id === draft.id) continue;
    if (shift.kind !== "arbeit") continue;
    if (!isTimeValue(shift.start) || !isTimeValue(shift.end)) continue;
    if (!Number.isFinite(dayIndex(shift.date))) continue;
    if (!duplicate && duplicateKey(shift) === ownKey) duplicate = true;
    if (!overlap) {
      const other = absoluteRange(shift);
      // Berührung (Ende = Beginn) ist keine Überschneidung – genau das macht der Zeit-Anschluss.
      if (other.to > own.from && other.from < own.to) overlap = shift;
    }
  }
  if (duplicate) warnings.push({ code: "duplicate" });
  if (overlap) {
    warnings.push({
      code: "overlap",
      vars: { start: overlap.start, end: overlap.end, date: overlap.date },
    });
  }

  return { errors, warnings, infos };
}

/** Erstes Feld mit einem blockierenden Befund (für die Fehleranzeige am Feld). */
export function fieldIssues(
  validation: EntryValidation,
): Partial<Record<EntryIssueField, EntryIssue>> {
  const out: Partial<Record<EntryIssueField, EntryIssue>> = {};
  for (const issue of validation.errors) {
    if (!issue.field || out[issue.field]) continue;
    out[issue.field] = issue;
  }
  return out;
}
