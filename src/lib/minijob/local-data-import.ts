/**
 * Expliziter, bestätigter Import lokaler Daten in den aktiven Namensraum.
 *
 * Quellen:
 * - `legacy`: alter globaler Bestand (`minijob-tracker-v1` + generierte Dokumente)
 *   aus der Zeit vor der Konto-Isolation. Er gehört niemandem automatisch.
 * - `demo`: Testmodus-Namensraum → angemeldetes Konto („Testdaten übernehmen“).
 *
 * Regeln:
 * - Nie automatisch; nur nach Klick des Nutzers.
 * - Die Quelle bleibt unverändert erhalten (nichts wird still gelöscht).
 * - Import in ein Konto setzt die Sync-Baseline zurück → `decideSync` liefert
 *   bei vorhandenem Cloud-Backup einen Konflikt (Nutzer entscheidet), ohne
 *   Backup einen Push. Ein bestehendes Backup wird nie still überschrieben.
 * - Hat der Ziel-Namensraum noch nicht gesicherte eigene Daten, wird der Import
 *   verweigert (kein Überschreiben lokaler Arbeit).
 * - Legacy-Daten, die laut alter Sync-Metadaten an ein Konto gebunden waren,
 *   werden nur genau diesem Konto angeboten (Besitznachweis), nie Gast/Testmodus
 *   oder einem anderen Konto.
 */
import {
  enterTestModeScope,
  getCloudUserId,
  hasUnsyncedLocalChanges,
  markExplicitImportForSync,
} from "./cloud";
import { mergeDeviceAuthFromLocal } from "./device-auth";
import {
  generatedDocsStorageKey,
  importGeneratedDocuments,
  readGeneratedDocumentsAt,
  type GeneratedDocument,
} from "./generated-docs";
import {
  clearDemoImportOffer,
  clearLegacyConsumed,
  hasDemoImportOffer,
  isLegacyConsumed,
  legacyConsumedBy,
  markLegacyConsumed,
  readImportDecision,
  writeImportDecision,
  type ImportSource,
} from "./import-offers";
import { DEMO_SCOPE, LEGACY_KEYS, scopeSuffix, type StorageScope } from "./storage-scope";
import {
  getActiveScope,
  getActiveScopeOwner,
  getData,
  hasMeaningfulData,
  readScopeData,
  readStoredData,
  replaceAll,
} from "./store";
import type { AppData } from "./types";

export type { ImportSource } from "./import-offers";

export type ImportCandidate = {
  source: ImportSource;
  data: AppData | null;
  docs: GeneratedDocument[];
  counts: { shifts: number; jobs: number; orders: number; docs: number };
  /** Legacy: alte Sync-Metadaten nennen genau das angemeldete Konto. */
  lastSyncedWithThisAccount: boolean;
  /** Legacy-Daten waren Testmodus-Daten. */
  wasDemo: boolean;
};

export type ImportResult =
  "imported" | "nothing" | "not-eligible" | "refused-unsynced" | "refused-not-empty";

function readLegacyMeta(): { owner: string | null; synced: boolean } {
  if (typeof window === "undefined") return { owner: null, synced: false };
  try {
    const raw = window.localStorage.getItem(LEGACY_KEYS.syncMeta);
    if (!raw) return { owner: null, synced: false };
    const parsed = JSON.parse(raw) as { userId?: unknown; lastSyncedAt?: unknown };
    const owner = typeof parsed.userId === "string" && parsed.userId ? parsed.userId : null;
    return { owner, synced: typeof parsed.lastSyncedAt === "number" };
  } catch {
    return { owner: null, synced: false };
  }
}

/**
 * Darf im aktiven Namensraum „Endgültig löschen“ angeboten werden? Nur dort, wo
 * der Bestand angeboten wird oder wohin er bereits übernommen wurde.
 */
export function canDiscardLegacy(scope: StorageScope = getActiveScope()): boolean {
  if (!hasLegacyData()) return false;
  return findLegacyCandidate(scope) !== null || legacyConsumedBy() === scopeSuffix(scope);
}

/** Liegt überhaupt noch ein Legacy-Bestand auf dem Gerät (für „Endgültig löschen“)? */
export function hasLegacyData(): boolean {
  return (
    hasMeaningfulData(readStoredData(LEGACY_KEYS.data)) ||
    readGeneratedDocumentsAt(LEGACY_KEYS.generatedDocs).length > 0
  );
}

function toCandidate(
  source: ImportSource,
  data: AppData | null,
  docs: GeneratedDocument[],
  lastSyncedWithThisAccount: boolean,
): ImportCandidate | null {
  if (!hasMeaningfulData(data) && docs.length === 0) return null;
  return {
    source,
    data: hasMeaningfulData(data) ? data : null,
    docs,
    counts: {
      shifts: data?.shifts.length ?? 0,
      jobs: data?.jobs.length ?? 0,
      orders: data?.orders.length ?? 0,
      docs: docs.length,
    },
    lastSyncedWithThisAccount,
    wasDemo: data?.settings.localDemoMode === true,
  };
}

/**
 * Legacy-Bestand, sofern er im aktiven Namensraum angeboten werden darf.
 * Gebunden an Konto X → nur im Namensraum von X (und nur, wenn X angemeldet ist).
 * Nie gebunden (Testmodus/Offline-Nutzung) → in jedem Namensraum anbietbar.
 */
export function findLegacyCandidate(
  scope: StorageScope = getActiveScope(),
): ImportCandidate | null {
  // Schon einmal übernommen → keinem weiteren Konto/Scope mehr anbieten.
  if (isLegacyConsumed()) return null;
  const data = readStoredData(LEGACY_KEYS.data);
  const docs = readGeneratedDocumentsAt(LEGACY_KEYS.generatedDocs);
  const { owner: legacyOwner, synced: legacySynced } = readLegacyMeta();
  if (legacyOwner !== null) {
    if (scope.kind !== "user" || scope.userId !== legacyOwner) return null;
    if (getCloudUserId() !== legacyOwner) return null;
  }
  return toCandidate(
    "legacy",
    data,
    docs,
    // Nur mit echtem Sync-Stand (lastSyncedAt): ein Rest aus dem alten A→B-Bug
    // (userId umgebogen, nie synchronisiert) gilt nicht als „mit diesem Konto synchronisiert“.
    legacySynced && legacyOwner !== null && scope.kind === "user" && scope.userId === legacyOwner,
  );
}

/** Testmodus-Daten, nur für ein angemeldetes Konto im eigenen Namensraum. */
export function findDemoCandidate(scope: StorageScope = getActiveScope()): ImportCandidate | null {
  if (scope.kind !== "user" || getCloudUserId() !== scope.userId) return null;
  return toCandidate(
    "demo",
    readScopeData(DEMO_SCOPE),
    readGeneratedDocumentsAt(generatedDocsStorageKey(DEMO_SCOPE)),
    false,
  );
}

export function findCandidate(source: ImportSource): ImportCandidate | null {
  return source === "legacy" ? findLegacyCandidate() : findDemoCandidate();
}

/**
 * Soll der Dialog automatisch erscheinen? Legacy: solange keine Entscheidung
 * für diesen Namensraum. Testmodus: nur direkt nach einem Login aus dem Testmodus.
 */
export function pendingPromptSources(scope: StorageScope = getActiveScope()): ImportSource[] {
  const out: ImportSource[] = [];
  if (findLegacyCandidate(scope) && readImportDecision(scope, "legacy") === null)
    out.push("legacy");
  if (
    scope.kind === "user" &&
    hasDemoImportOffer(scope.userId) &&
    findDemoCandidate(scope) &&
    readImportDecision(scope, "demo") === null
  ) {
    out.push("demo");
  }
  return out;
}

/** „Ignorieren“ / „Mit leerem Konto starten“: nichts importieren, Quelle bleibt erhalten. */
export function declineImport(source: ImportSource): void {
  const scope = getActiveScope();
  writeImportDecision(scope, source, "ignored");
  if (source === "demo" && scope.kind === "user") clearDemoImportOffer(scope.userId);
}

/** Expliziter Import nach Bestätigung durch den Nutzer. */
export function importLocalData(source: ImportSource): ImportResult {
  const candidate = findCandidate(source);
  if (!candidate) return "nothing";
  let scope = getActiveScope();

  if (scope.kind === "user") {
    // Owner guard: nur in den Namensraum des tatsächlich angemeldeten Kontos.
    if (getActiveScopeOwner() !== getCloudUserId()) return "not-eligible";
    const target = getData();
    if (hasMeaningfulData(target) && hasUnsyncedLocalChanges()) return "refused-unsynced";
    if (candidate.data) {
      const merged = mergeDeviceAuthFromLocal(candidate.data, target);
      replaceAll({
        ...merged,
        settings: { ...merged.settings, localDemoMode: false },
        timer: target.timer ?? candidate.data.timer ?? null,
      });
    }
    importGeneratedDocuments(candidate.docs);
    writeImportDecision(scope, source, "imported");
    if (source === "legacy") markLegacyConsumed(scope);
    if (source === "demo") clearDemoImportOffer(scope.userId);
    // Nur mit Arbeitsdaten die Sync-Baseline zurücksetzen (Konflikt statt Überschreiben).
    if (candidate.data) markExplicitImportForSync();
    return "imported";
  }

  // Nicht angemeldet: nur ungebundene Legacy-Daten; Testmodus-Daten → Testmodus.
  if (source !== "legacy") return "not-eligible";
  if (candidate.wasDemo && scope.kind === "guest") {
    if (!enterTestModeScope()) return "not-eligible";
    scope = getActiveScope();
  }
  if (hasMeaningfulData(getData())) return "refused-not-empty";
  if (candidate.data) {
    const merged = mergeDeviceAuthFromLocal(candidate.data, getData());
    replaceAll({
      ...merged,
      settings: {
        ...merged.settings,
        localDemoMode: scope.kind === "demo" ? true : merged.settings.localDemoMode === true,
      },
    });
  }
  importGeneratedDocuments(candidate.docs);
  writeImportDecision(scope, source, "imported");
  markLegacyConsumed(scope);
  return "imported";
}

/**
 * Legacy-Bestand endgültig von diesem Gerät löschen – nur nach ausdrücklicher
 * Bestätigung im UI. Entfernt ausschließlich die alten globalen App-Schlüssel.
 */
export function discardLegacyData(): void {
  if (typeof window === "undefined") return;
  for (const key of Object.values(LEGACY_KEYS)) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
  clearLegacyConsumed();
}
