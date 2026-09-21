import type { Shift, WorkCodeDef } from "./types";

/**
 * Builtin-Leistungsarten — gleiche Werte wie in arbeitsnachweis.ts.
 * Kein Import von dort: Store → Catalog darf PDF/i18n nicht ziehen.
 */
const BUILTIN_WORK_CODES = ["UR", "FR", "ER", "BR", "SR"] as const;
const BUILTIN_WORK_CODE_LABELS: Record<(typeof BUILTIN_WORK_CODES)[number], string> = {
  UR: "Unterhaltsreinigung",
  FR: "Fensterreinigung",
  ER: "Endreinigung",
  BR: "Büroreinigung",
  SR: "Sonderreinigung",
};

function templateValue(key: string): string {
  return `#${key}`;
}

/** Trim + collapse inner space. Keeps user wording otherwise. */
export function normalizeCatalogText(value: string | undefined | null): string {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

/** Leistungsart-Code: trim, collapse space, uppercase. */
export function normalizeWorkCode(value: string | undefined | null): string {
  return normalizeCatalogText(value).toUpperCase();
}

/** Duplicate-Vergleich für Tätigkeiten: trim/collapse, case-insensitive. */
export function normalizeTaskCompare(value: string | undefined | null): string {
  return normalizeCatalogText(value).toLowerCase();
}

export function isBuiltinWorkCode(code: string | undefined | null): boolean {
  const normalized = normalizeWorkCode(code);
  return (BUILTIN_WORK_CODES as readonly string[]).includes(normalized);
}

export function builtinWorkCodes(): WorkCodeDef[] {
  return BUILTIN_WORK_CODES.map((code) => ({ code, label: BUILTIN_WORK_CODE_LABELS[code] }));
}

/** Vordefinierte + gespeicherte Custom-Codes; Builtins nicht verdoppeln. */
export function mergeWorkCodeCatalog(custom: readonly WorkCodeDef[]): WorkCodeDef[] {
  const builtins = builtinWorkCodes();
  const builtinSet = new Set(builtins.map((c) => c.code));
  const extras: WorkCodeDef[] = [];
  const seen = new Set<string>();
  for (const item of custom) {
    const code = normalizeWorkCode(item.code);
    if (!code || builtinSet.has(code) || seen.has(code)) continue;
    seen.add(code);
    extras.push({
      code,
      label: normalizeCatalogText(item.label) || item.label,
    });
  }
  return [...builtins, ...extras];
}

/** Wie applyObjectToFormFields: gespeicherte Leistungsart → Eintragsfelder. */
export interface WorkCodeFormFields {
  workCode: string;
  workCodeLabel: string;
}

export function applyWorkCodeToFormFields(item: WorkCodeDef): WorkCodeFormFields {
  return {
    workCode: normalizeWorkCode(item.code),
    workCodeLabel: normalizeCatalogText(item.label),
  };
}

export function findWorkCodeDef(
  catalog: readonly WorkCodeDef[],
  codeRaw: string,
): WorkCodeDef | undefined {
  const code = normalizeWorkCode(codeRaw);
  if (!code) return undefined;
  return mergeWorkCodeCatalog(catalog).find((c) => normalizeWorkCode(c.code) === code);
}

export type AddWorkCodeResult =
  | { status: "empty" }
  | { status: "conflict"; existing: WorkCodeDef }
  | { status: "exists"; catalog: WorkCodeDef[]; item: WorkCodeDef }
  | { status: "added"; catalog: WorkCodeDef[]; item: WorkCodeDef };

/**
 * Fügt eine Custom-Leistungsart zum Katalog hinzu.
 * - leer → empty
 * - gleicher Code + gleiche Bezeichnung (inkl. Builtin) → exists, kein Duplikat
 * - gleicher Code, andere Bezeichnung → conflict, kein stilles Überschreiben
 */
export function addWorkCodeToCatalog(
  catalog: readonly WorkCodeDef[],
  codeRaw: string,
  labelRaw: string,
): AddWorkCodeResult {
  const code = normalizeWorkCode(codeRaw);
  const label = normalizeCatalogText(labelRaw);
  if (!code || !label) return { status: "empty" };

  const item: WorkCodeDef = { code, label };
  const builtin = isBuiltinWorkCode(code)
    ? {
        code,
        label: BUILTIN_WORK_CODE_LABELS[code as (typeof BUILTIN_WORK_CODES)[number]],
      }
    : undefined;
  if (builtin) {
    if (normalizeTaskCompare(builtin.label) === normalizeTaskCompare(label)) {
      return { status: "exists", catalog: catalog as WorkCodeDef[], item: builtin };
    }
    return { status: "conflict", existing: builtin };
  }

  const existing = catalog.find((c) => normalizeWorkCode(c.code) === code);
  if (existing) {
    if (normalizeTaskCompare(existing.label) === normalizeTaskCompare(label)) {
      return { status: "exists", catalog: catalog as WorkCodeDef[], item: existing };
    }
    return { status: "conflict", existing };
  }

  return { status: "added", catalog: [...catalog, item], item };
}

export type PredefinedTaskLabel = { key: string; label: string };

export type AddCustomTaskResult =
  | { status: "empty" }
  | { status: "predefined"; value: string }
  | { status: "exists"; catalog: string[]; value: string }
  | { status: "added"; catalog: string[]; value: string };

export function findPredefinedTaskValue(
  raw: string,
  predefinedLabels: readonly PredefinedTaskLabel[] = [],
): string | undefined {
  const trimmed = normalizeCatalogText(raw);
  if (!trimmed) return undefined;
  if (trimmed.startsWith("#")) {
    const key = trimmed.slice(1);
    if (key) return templateValue(key);
  }
  const compare = normalizeTaskCompare(trimmed);
  for (const { key, label } of predefinedLabels) {
    if (normalizeTaskCompare(label) === compare || normalizeTaskCompare(key) === compare) {
      return templateValue(key);
    }
  }
  return undefined;
}

/**
 * Speichert eine eigene Tätigkeit im Katalog.
 * Vordefinierte Labels werden nicht als Custom-Zeile abgelegt.
 */
export function addCustomTaskToCatalog(
  catalog: readonly string[],
  raw: string,
  predefinedLabels: readonly PredefinedTaskLabel[] = [],
): AddCustomTaskResult {
  const value = normalizeCatalogText(raw);
  if (!value) return { status: "empty" };

  const predefined = findPredefinedTaskValue(value, predefinedLabels);
  if (predefined) return { status: "predefined", value: predefined };

  const existing = catalog.find((item) => normalizeTaskCompare(item) === normalizeTaskCompare(value));
  if (existing) {
    return { status: "exists", catalog: catalog as string[], value: existing };
  }
  return { status: "added", catalog: [...catalog, value], value };
}

/**
 * Eintrag speichert den Label-Snapshot. Beim erneuten Speichern derselben
 * Leistungsart bleibt der historische Text stehen — Katalogänderungen
 * überschreiben alte Schichten nicht.
 */
export function snapshotWorkCodeLabel(args: {
  selectedCode: string;
  catalog: readonly WorkCodeDef[];
  previousCode?: string | undefined;
  previousLabel?: string | undefined;
}): string | undefined {
  const selected = normalizeWorkCode(args.selectedCode);
  if (!selected) return undefined;
  if (
    normalizeWorkCode(args.previousCode) === selected &&
    normalizeCatalogText(args.previousLabel)
  ) {
    return normalizeCatalogText(args.previousLabel);
  }
  const fromCatalog = mergeWorkCodeCatalog(args.catalog).find(
    (c) => normalizeWorkCode(c.code) === selected,
  );
  const label = normalizeCatalogText(fromCatalog?.label);
  return label || undefined;
}

/** PDF-Legende: Schicht-Snapshot vor aktuellem Katalog, vor Builtin. */
export function legendLabelForWorkCode(
  code: string,
  shifts: readonly Pick<Shift, "workCode" | "workCodeLabel">[],
  catalog: readonly WorkCodeDef[] = [],
): string {
  const normalized = normalizeWorkCode(code);
  if (!normalized) return "";
  const snapshot = shifts.find(
    (s) =>
      normalizeWorkCode(s.workCode) === normalized && normalizeCatalogText(s.workCodeLabel),
  );
  if (snapshot?.workCodeLabel) return normalizeCatalogText(snapshot.workCodeLabel);
  const merged = mergeWorkCodeCatalog(catalog).find((c) => normalizeWorkCode(c.code) === normalized);
  return normalizeCatalogText(merged?.label) || normalized;
}

/**
 * ADD-only: Custom-Leistungsarten aus bestehenden Schichten nachziehen.
 * Schichten werden nicht mutiert; vorhandene Katalog-Labels nicht überschrieben.
 * Duplikat = Code + Bezeichnung (normalisiert); gleicher Code andere Bezeichnung → kein zweites Item.
 */
export function ensureWorkCodesFromShifts(
  catalog: readonly WorkCodeDef[],
  shifts: readonly Pick<Shift, "workCode" | "workCodeLabel">[],
): WorkCodeDef[] {
  let next = catalog as WorkCodeDef[];
  let changed = false;
  for (const shift of shifts) {
    const code = shift.workCode ?? "";
    const label = normalizeCatalogText(shift.workCodeLabel) || normalizeWorkCode(code);
    const result = addWorkCodeToCatalog(next, code, label);
    if (result.status === "added") {
      next = result.catalog;
      changed = true;
    }
  }
  return changed ? next : (catalog as WorkCodeDef[]);
}

/**
 * ADD-only: freie Tätigkeiten (kein #key) in den Katalog übernehmen.
 * Schichten bleiben unverändert.
 */
export function ensureCustomTasksFromShifts(
  catalog: readonly string[],
  shifts: readonly Pick<Shift, "tasks">[],
  predefinedLabels: readonly PredefinedTaskLabel[] = [],
): string[] {
  let next = catalog as string[];
  let changed = false;
  for (const shift of shifts) {
    for (const raw of shift.tasks ?? []) {
      if (raw.startsWith("#")) continue;
      const result = addCustomTaskToCatalog(next, raw, predefinedLabels);
      if (result.status === "added") {
        next = result.catalog;
        changed = true;
      }
    }
  }
  return changed ? next : (catalog as string[]);
}

/**
 * Wie Adresse → WorkObject: Werte der gespeicherten Schicht ADD-only in die
 * wiederverwendbare Liste übernehmen. Schichten und vorhandene Labels bleiben.
 */
export function learnSavedValuesFromShift(
  workCodes: readonly WorkCodeDef[],
  customTasks: readonly string[],
  shift: Pick<Shift, "workCode" | "workCodeLabel" | "tasks">,
): { workCodes: WorkCodeDef[]; customTasks: string[] } {
  const nextCodes = ensureWorkCodesFromShifts(workCodes, [shift]);
  const nextTasks = ensureCustomTasksFromShifts(customTasks, [shift]);
  return { workCodes: nextCodes, customTasks: nextTasks };
}
