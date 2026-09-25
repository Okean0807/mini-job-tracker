/**
 * Persistente Entscheidungen / Angebote für den expliziten Import lokaler Daten
 * (Legacy-Gerätedaten, Testmodus → Konto). Keine Abhängigkeiten außer Scope-Helfern.
 */
import { scopeSuffix, type StorageScope } from "./storage-scope";

export type ImportSource = "legacy" | "demo";
export type ImportDecision = "imported" | "ignored";

const DECISION_KEY_BASE = "minijob-local-import-decision-v1";
const DEMO_OFFER_KEY_BASE = "minijob-demo-import-offer-v1";

function decisionKey(scope: StorageScope, source: ImportSource): string {
  return `${DECISION_KEY_BASE}:${source}:${scopeSuffix(scope)}`;
}

export function readImportDecision(
  scope: StorageScope,
  source: ImportSource,
): ImportDecision | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(decisionKey(scope, source));
    return raw === "imported" || raw === "ignored" ? raw : null;
  } catch {
    return null;
  }
}

export function writeImportDecision(
  scope: StorageScope,
  source: ImportSource,
  decision: ImportDecision | null,
): void {
  if (typeof window === "undefined") return;
  try {
    if (decision) window.localStorage.setItem(decisionKey(scope, source), decision);
    else window.localStorage.removeItem(decisionKey(scope, source));
  } catch {
    /* ignore */
  }
}

/**
 * Legacy-Bestand wurde (in irgendeinen Namensraum) übernommen → global verbraucht.
 * Er wird keinem weiteren Konto/Scope mehr zur Übernahme angeboten; die Quelle
 * bleibt als Sicherung liegen, bis der Nutzer sie ausdrücklich löscht.
 */
const LEGACY_CONSUMED_KEY = "minijob-legacy-import-consumed-v1";

export function markLegacyConsumed(scope: StorageScope): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      LEGACY_CONSUMED_KEY,
      JSON.stringify({ scope: scopeSuffix(scope), at: Date.now() }),
    );
  } catch {
    /* ignore */
  }
}

export function isLegacyConsumed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(LEGACY_CONSUMED_KEY) !== null;
  } catch {
    return false;
  }
}

/** Scope-Suffix, in den der Legacy-Bestand übernommen wurde (oder null). */
export function legacyConsumedBy(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LEGACY_CONSUMED_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { scope?: unknown };
    return typeof parsed.scope === "string" ? parsed.scope : null;
  } catch {
    return null;
  }
}

export function clearLegacyConsumed(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LEGACY_CONSUMED_KEY);
  } catch {
    /* ignore */
  }
}

/** Nach OAuth aus dem Testmodus: Konto soll die Wahl „Testdaten übernehmen / leer starten“ sehen. */
export function flagDemoImportOffer(userId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${DEMO_OFFER_KEY_BASE}:u:${userId}`, "1");
  } catch {
    /* ignore */
  }
}

export function hasDemoImportOffer(userId: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(`${DEMO_OFFER_KEY_BASE}:u:${userId}`) === "1";
  } catch {
    return false;
  }
}

export function clearDemoImportOffer(userId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(`${DEMO_OFFER_KEY_BASE}:u:${userId}`);
  } catch {
    /* ignore */
  }
}
