/**
 * Account-/Testmodus-Isolation für alle gerätelokalen App-Daten (P0).
 *
 * Jeder lokale Datenbestand (AppData, Sync-Metadaten, generierte Dokumente,
 * Onboarding-Entwurf) liegt unter einem *Namensraum* (Scope):
 *
 * - `u:<supabaseUserId>` – angemeldetes Konto (nie E-Mail, immer `user.id`)
 * - `demo`               – Testmodus (lokal, ohne Konto)
 * - `guest`              – nicht angemeldet, kein Testmodus (Erststart / nach Logout)
 *
 * Alte globale Schlüssel (`minijob-tracker-v1`, …) gelten als *Legacy / ohne
 * Besitzer*: sie werden weder gelesen noch beschrieben – nur ein expliziter,
 * bestätigter Import (siehe `local-data-import.ts`) übernimmt sie.
 *
 * Dieses Modul ist zustandslos (reine Helfer); der aktive Scope lebt im Store
 * (`store.ts`), damit In-Memory-Daten und Scope nie auseinanderlaufen.
 */

export type StorageScope = { kind: "user"; userId: string } | { kind: "demo" } | { kind: "guest" };

export const GUEST_SCOPE: StorageScope = { kind: "guest" };
export const DEMO_SCOPE: StorageScope = { kind: "demo" };

export function userScope(userId: string): StorageScope {
  return { kind: "user", userId };
}

/** Zeiger auf den zuletzt aktiven Scope (nur für den synchronen App-Start). */
export const ACTIVE_SCOPE_POINTER_KEY = "minijob-active-scope-v1";

/** Legacy-Schlüssel (global, ohne Besitzer) – werden nie automatisch zugeordnet. */
export const LEGACY_KEYS = {
  data: "minijob-tracker-v1",
  syncMeta: "minijob-sync-meta-v1",
  generatedDocs: "minijob-generated-docs-v1",
  onboardingDraft: "minijob-onboarding-draft-v2",
} as const;

export function scopeSuffix(scope: StorageScope): string {
  switch (scope.kind) {
    case "user":
      return `u:${scope.userId}`;
    case "demo":
      return "demo";
    case "guest":
      return "guest";
  }
}

export function parseScopeSuffix(raw: string | null | undefined): StorageScope | null {
  if (!raw) return null;
  if (raw === "demo") return DEMO_SCOPE;
  if (raw === "guest") return GUEST_SCOPE;
  if (raw.startsWith("u:") && raw.length > 2) return userScope(raw.slice(2));
  return null;
}

/** `<base>:<scope>` – z. B. `minijob-tracker-v1:u:<id>`. */
export function scopedKey(base: string, scope: StorageScope): string {
  return `${base}:${scopeSuffix(scope)}`;
}

export function sameScope(a: StorageScope, b: StorageScope): boolean {
  return scopeSuffix(a) === scopeSuffix(b);
}

/** Konto-Id des Scopes (nur `user`), sonst null. */
export function ownerOfScope(scope: StorageScope): string | null {
  return scope.kind === "user" ? scope.userId : null;
}

/** Zeiger schreiben – nur der Store ruft das beim Scope-Wechsel auf. */
export function persistScopePointer(scope: StorageScope): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ACTIVE_SCOPE_POINTER_KEY, scopeSuffix(scope));
  } catch {
    /* blockiert – Start fällt dann auf guest zurück */
  }
}

export function readScopePointer(): StorageScope {
  if (typeof window === "undefined") return GUEST_SCOPE;
  try {
    return parseScopeSuffix(window.localStorage.getItem(ACTIVE_SCOPE_POINTER_KEY)) ?? GUEST_SCOPE;
  } catch {
    return GUEST_SCOPE;
  }
}

/* ---------- OAuth aus dem Testmodus / Gast (Handoff über den Redirect) ---------- */

export const OAUTH_PENDING_KEY = "minijob-oauth-pending-v1";
/** Marker verfällt, damit ein abgebrochener Login später nichts auslöst. */
export const OAUTH_PENDING_TTL_MS = 30 * 60 * 1000;

export type OAuthPendingMarker = {
  from: "demo" | "guest";
  at: number;
};

/**
 * Vor dem OAuth-Redirect setzen. Der Testmodus bleibt dabei unverändert aktiv –
 * bricht der Nutzer bei Google ab, ist er weiter im Testmodus mit allen Daten.
 */
export function markOAuthPending(scope: StorageScope): void {
  if (typeof window === "undefined") return;
  if (scope.kind === "user") return;
  const marker: OAuthPendingMarker = { from: scope.kind, at: Date.now() };
  try {
    window.localStorage.setItem(OAUTH_PENDING_KEY, JSON.stringify(marker));
  } catch {
    /* ignore */
  }
}

export function readOAuthPending(now: number = Date.now()): OAuthPendingMarker | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(OAUTH_PENDING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OAuthPendingMarker>;
    if ((parsed.from !== "demo" && parsed.from !== "guest") || typeof parsed.at !== "number") {
      return null;
    }
    if (now - parsed.at > OAUTH_PENDING_TTL_MS || parsed.at > now + 60_000) return null;
    return { from: parsed.from, at: parsed.at };
  } catch {
    return null;
  }
}

/** Remove every app-owned localStorage key belonging to one user scope.
 * This is intentionally suffix-based so newly added scoped stores are also
 * removed during account deletion without maintaining a second key registry.
 */
export function clearUserScopeLocalData(userId: string): void {
  if (typeof window === "undefined" || !userId) return;
  const suffix = `:u:${userId}`;
  try {
    const keys = Object.keys(window.localStorage);
    for (const key of keys) {
      if (key.endsWith(suffix)) window.localStorage.removeItem(key);
    }
  } catch {
    /* best effort; account deletion remains server-authoritative */
  }
}

export function clearOAuthPending(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(OAUTH_PENDING_KEY);
  } catch {
    /* ignore */
  }
}
