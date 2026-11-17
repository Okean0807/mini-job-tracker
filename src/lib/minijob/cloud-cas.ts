/**
 * Data-safety Phase 4: bedingtes Schreiben (Compare-and-Swap) der Cloud-Sicherung `backups`.
 *
 * Kein `.upsert()`: ein vorhandener Stand wird nur ersetzt, wenn `user_id` UND der exakt
 * beobachtete `updated_at` noch passen (`.update().eq().eq().select()`, genau EINE Zeile = Erfolg).
 * Fehlt die Zeile, wird mit `.insert()` angelegt. Das Modul kennt weder Store noch Sync-Zustand.
 *
 * GRENZEN (bewusst nicht behauptet):
 *  - Ältere App-Versionen (und der Service-Role-Zugriff) können weiterhin blind schreiben
 *    (`upsert`). Vollständiger Schutz braucht eine serverseitige Erzwingung – eigene Freigabe.
 *  - Das Verhalten gegenüber dem echten PostgREST ist NICHT durch diese Tests bewiesen
 *    (Mocks); es ist am Live-System zu prüfen.
 */

/** Minimaler, strukturell typisierter Teil des Supabase-Clients (Tests liefern ein Double). */
export interface BackupsTable {
  select(columns: string): {
    eq(
      column: string,
      value: string,
    ): { maybeSingle(): PromiseLike<{ data: unknown; error: unknown }> };
  };
  insert(row: unknown): { select(columns: string): PromiseLike<CasResponse> };
  update(row: unknown): {
    eq(
      column: string,
      value: string,
    ): {
      eq(column: string, value: string): { select(columns: string): PromiseLike<CasResponse> };
    };
  };
}

export interface CasResponse {
  data: { updated_at?: unknown }[] | null;
  error: { code?: string; message?: string } | null;
}

export type CasOutcome =
  /** Genau eine Zeile geschrieben; `token` ist der vom Server zurückgegebene `updated_at`. */
  | { kind: "written"; mode: "update" | "insert"; token: string; updatedAtMs: number }
  /** Null Zeilen (Stand verändert/gelöscht) oder Zeile existiert inzwischen (23505). */
  | { kind: "stale"; reason: "zero-rows" | "unique-violation" }
  /** Konto existiert nicht mehr (23503). */
  | { kind: "account-gone" }
  /** Auth/RLS (42501 oder HTTP 401/403). */
  | { kind: "forbidden" }
  /** Ergebnis unbekannt (Netzwerk/Timeout/unerwartete Antwort): NIE blind wiederholen. */
  | { kind: "ambiguous" }
  /** Eindeutiger Serverfehler ohne Schreibwirkung. */
  | { kind: "error"; code: string };

export interface CasInput {
  table: BackupsTable;
  userId: string;
  /** Exakter, zuvor beobachteter `updated_at`-String; `null` = es gab keine Zeile. */
  observedToken: string | null;
  payload: unknown;
  /** Neuer Token (siehe `nextToken`). */
  token: string;
}

/**
 * Neuer Token, garantiert verschieden (und zeitlich später) vom beobachteten.
 * Millisekunden-ISO: überlebt die Rundreise durch `timestamptz` unverändert in der Instanz.
 */
export function nextToken(observedToken: string | null, nowMs: number = Date.now()): string {
  const observed = observedToken ? Date.parse(observedToken) : Number.NaN;
  const ms = Number.isFinite(observed) ? Math.max(nowMs, observed + 1) : nowMs;
  return new Date(ms).toISOString();
}

/** Gleicher Zeitpunkt (Darstellung darf abweichen: `Z` vs. `+00:00`, Nachkommastellen). */
export function sameInstant(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const x = Date.parse(a);
  const y = Date.parse(b);
  return Number.isFinite(x) && Number.isFinite(y) && x === y;
}

function classify(error: { code?: string; message?: string }): CasOutcome {
  const code = String(error.code ?? "");
  if (code === "23505") return { kind: "stale", reason: "unique-violation" };
  if (code === "23503") return { kind: "account-gone" };
  if (code === "42501" || code === "401" || code === "403" || code === "PGRST301") {
    return { kind: "forbidden" };
  }
  // Ohne Datenbankcode (Netzwerk, Abbruch, unlesbare Antwort) ist das Ergebnis unbekannt.
  if (code === "") return { kind: "ambiguous" };
  return { kind: "error", code };
}

function readToken(response: CasResponse): CasOutcome | { token: string; updatedAtMs: number } {
  const rows = response.data;
  if (!Array.isArray(rows)) return { kind: "ambiguous" };
  if (rows.length !== 1) {
    // Mehr als eine Zeile ist bei Primärschlüssel unmöglich → unerwartet, nicht als Erfolg werten.
    return rows.length === 0 ? { kind: "stale", reason: "zero-rows" } : { kind: "ambiguous" };
  }
  const raw = rows[0]?.updated_at;
  const token = typeof raw === "string" && raw !== "" ? raw : null;
  const ms = token ? Date.parse(token) : Number.NaN;
  if (!token || !Number.isFinite(ms)) return { kind: "ambiguous" };
  return { token, updatedAtMs: ms };
}

/**
 * Ein bedingter Schreibversuch. Wirft nie: jede Ausnahme (z. B. Netzwerk) wird `ambiguous`,
 * weil nicht feststeht, ob der Server die Anfrage verarbeitet hat.
 */
export async function casWrite(input: CasInput): Promise<CasOutcome> {
  const { table, userId, observedToken, payload, token } = input;
  const row = { payload, updated_at: token };
  try {
    if (observedToken === null) {
      const response = await table.insert({ user_id: userId, ...row }).select("updated_at");
      if (response.error) return classify(response.error);
      const read = readToken(response);
      if ("kind" in read) return read;
      return { kind: "written", mode: "insert", ...read };
    }
    const response = await table
      .update(row)
      .eq("user_id", userId)
      .eq("updated_at", observedToken)
      .select("updated_at");
    if (response.error) return classify(response.error);
    const read = readToken(response);
    if ("kind" in read) return read;
    return { kind: "written", mode: "update", ...read };
  } catch {
    return { kind: "ambiguous" };
  }
}

/* ------------------------------------------------ Unklares Ergebnis (Timeout) */

/** Vor dem Senden festgehalten; bleibt stehen, bis das Ergebnis geklärt ist. */
export interface PendingWrite {
  /** Zuvor beobachteter Token (`null` = Insert). */
  observedToken: string | null;
  /** Token, den der Versuch geschrieben hätte. */
  attemptedToken: string;
  /** `fullFingerprint` der gesendeten Nutzlast. */
  fingerprint: string;
  at: number;
}

export type PendingResolution =
  /** Token UND Inhalt stimmen: der Schreibvorgang ist angekommen. */
  | "adopt"
  /** Cloud entspricht weiterhin dem beobachteten Stand: nicht angekommen → neu vorbereiten. */
  | "not-landed"
  /** Alles andere: jemand anderes hat geschrieben → Konflikt. */
  | "conflict";

export function resolvePendingWrite(
  pending: PendingWrite,
  remote: { token: string; fingerprint: string } | null,
): PendingResolution {
  if (remote === null) return pending.observedToken === null ? "not-landed" : "conflict";
  if (sameInstant(remote.token, pending.attemptedToken)) {
    return remote.fingerprint === pending.fingerprint ? "adopt" : "conflict";
  }
  if (pending.observedToken !== null && sameInstant(remote.token, pending.observedToken)) {
    return "not-landed";
  }
  return "conflict";
}
