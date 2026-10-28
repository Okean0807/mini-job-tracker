import { FeedbackError, parseFeedbackInput, type FeedbackInput } from "./schema";

/**
 * Server-Logik ohne Framework-Abhängigkeiten (testbar mit Fake-RPC).
 *
 * Variante C2: nur angemeldete Nutzer. Der RPC läuft mit dem Supabase-Client des Nutzers
 * (`requireSupabaseAuth`, publishable Key + JWT des Nutzers) – es gibt keinen service_role-Schlüssel.
 * Der Autor wird in `public.submit_feedback` ausschließlich aus `auth.uid()` bestimmt; es gibt
 * keinen user-id-Parameter. Die Prüfungen hier sind Komfort/Fehlermaskierung; die verbindliche Prüfung
 * und die Limits liegen in SQL (der RPC kann auch direkt aufgerufen werden).
 *
 * Fail-closed: Bestätigt wird nur, wenn die Datenbank ausdrücklich `created` oder `duplicate` meldet.
 */
export interface FeedbackRpcRow {
  status?: string | null;
  retry_after_seconds?: number | null;
}

export interface FeedbackDeps {
  /** `submit_feedback` über den Client des angemeldeten Nutzers. */
  rpc: (
    fn: "submit_feedback",
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: unknown }>;
  log?: (event: string, fields: Record<string, unknown>) => void;
}

export type FeedbackResult = { ok: true; duplicate: boolean };

export async function handleFeedback(raw: unknown, deps: FeedbackDeps): Promise<FeedbackResult> {
  const input: FeedbackInput = parseFeedbackInput(raw);

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
  switch (row?.status) {
    case "created":
      return { ok: true, duplicate: false };
    case "duplicate":
      return { ok: true, duplicate: true };
    case "rate_limited":
      throw new FeedbackError("rate_limited", Math.max(1, Number(row.retry_after_seconds ?? 60)));
    case "invalid":
      throw new FeedbackError("invalid");
    case "unauthenticated":
      throw new FeedbackError("unauthenticated");
    case "forbidden":
      throw new FeedbackError("forbidden");
    default:
      deps.log?.("feedback.unexpected-result", {});
      throw new FeedbackError("unavailable");
  }
}
