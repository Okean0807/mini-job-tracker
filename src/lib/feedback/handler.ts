import { FeedbackError, parseFeedbackInput, type FeedbackInput } from "./schema";

/**
 * Server-Logik ohne Framework-Abhängigkeiten (testbar mit Fake-RPC).
 *
 * Fail-closed: Bestätigt wird nur, wenn die Datenbank ausdrücklich `created` oder
 * `duplicate` meldet. Alles andere ist ein Fehler – der Nutzer bekommt nie ein
 * falsches „gesendet“. Gespeichert werden ausschließlich die Felder von `FeedbackInput`.
 */
export interface FeedbackRpcRow {
  status?: string | null;
  retry_after_seconds?: number | null;
}

export interface FeedbackDeps {
  /** `submit_feedback` (SECURITY DEFINER, nur service_role). */
  rpc: (
    fn: "submit_feedback",
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: unknown }>;
  /**
   * Nicht umkehrbarer Schlüssel pro Client (HMAC der normalisierten IP), nie die IP selbst.
   * Als Funktion wird er erst nach der Eingabeprüfung gebildet; sie wirft FeedbackError("unavailable"),
   * wenn Secret oder vertrauenswürdige IP fehlen (fail closed, kein gemeinsamer Bucket).
   */
  clientKey: string | (() => string);
  log?: (event: string, fields: Record<string, unknown>) => void;
}

export type FeedbackResult = { ok: true; duplicate: boolean };

export async function handleFeedback(raw: unknown, deps: FeedbackDeps): Promise<FeedbackResult> {
  const input: FeedbackInput = parseFeedbackInput(raw);

  // Honeypot: Bots füllen das Feld. Stillschweigend „annehmen“, nichts speichern.
  if (input.website && input.website.trim() !== "") {
    deps.log?.("feedback.honeypot", {});
    return { ok: true, duplicate: false };
  }

  let clientKey: string;
  try {
    clientKey = typeof deps.clientKey === "function" ? deps.clientKey() : deps.clientKey;
  } catch (error) {
    throw error instanceof FeedbackError ? error : new FeedbackError("unavailable");
  }

  let response: { data: unknown; error: unknown };
  try {
    response = await deps.rpc("submit_feedback", {
      p_submission_id: input.submissionId,
      p_kind: input.kind,
      p_message: input.message.trim(),
      p_rating: input.kind === "rating" ? input.rating : null,
      p_app_version: input.appVersion,
      p_lang: input.lang,
      p_route: input.route,
      p_client_key: clientKey,
    });
  } catch {
    deps.log?.("feedback.rpc-threw", {});
    throw new FeedbackError("unavailable");
  }
  if (response.error) {
    deps.log?.("feedback.rpc-error", {});
    throw new FeedbackError("unavailable");
  }

  const rows = response.data as FeedbackRpcRow[] | FeedbackRpcRow | null | undefined;
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (row?.status === "created") return { ok: true, duplicate: false };
  if (row?.status === "duplicate") return { ok: true, duplicate: true };
  if (row?.status === "rate_limited") {
    throw new FeedbackError("rate_limited", Math.max(1, Number(row.retry_after_seconds ?? 60)));
  }
  deps.log?.("feedback.unexpected-result", {});
  throw new FeedbackError("unavailable");
}
