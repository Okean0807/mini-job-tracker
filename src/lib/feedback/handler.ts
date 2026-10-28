import { sendMail, type MailMessage, type MailResult } from "./mailer";
import type { RateLimiter } from "./rate-limit";
import { cleanMessage, FeedbackError, parseFeedbackInput } from "./schema";

/**
 * Server-Logik ohne Framework-Abhängigkeiten (testbar mit Fake-Mailer).
 *
 * - Nur angemeldete Nutzer: `requireSupabaseAuth` hat das JWT geprüft; hier kommen `userId`, optional
 *   die verifizierte E-Mail-Adresse und das Anonym-Flag aus den Claims – nie aus der Anfrage.
 * - Der Empfänger kommt nur aus der Server-Konfiguration (`config.to`); die Anfrage kann ihn nicht setzen.
 * - „Gesendet“ wird nur gemeldet, wenn der E-Mail-Dienst die Annahme bestätigt hat (Nachrichten-ID).
 */
export interface MailConfig {
  apiKey: string;
  to: string;
  from: string;
}

export interface FeedbackDeps {
  user: { id: string; email?: string | undefined; isAnonymous?: boolean | undefined };
  /** null = nicht (korrekt) konfiguriert → Versand verweigert (fail closed). */
  config: MailConfig | null;
  rateLimiter: RateLimiter;
  send?: (message: MailMessage, config: MailConfig) => Promise<MailResult>;
  /** Bereits gesendete Formular-IDs dieser Instanz (best effort gegen doppelte Mails). */
  sent?: Set<string>;
  log?: (event: string, fields: Record<string, unknown>) => void;
}

export type FeedbackResult = { ok: true; duplicate: boolean };

const SUBJECT = "MiniJob Companion – Feedback";
const EMAIL_RE = /^[^\s@<>,;"]{1,64}@[^\s@<>,;"]{1,255}$/;
export const isPlainEmail = (value: string) => value.length <= 254 && EMAIL_RE.test(value);

/** Liest und prüft die Server-Umgebung; null, wenn etwas fehlt oder ungültig ist. */
export function readMailConfig(env: {
  RESEND_API_KEY?: string | undefined;
  FEEDBACK_TO_EMAIL?: string | undefined;
  FEEDBACK_FROM_EMAIL?: string | undefined;
}): MailConfig | null {
  const apiKey = env.RESEND_API_KEY?.trim();
  const to = env.FEEDBACK_TO_EMAIL?.trim();
  // Testabsender des Dienstes; für den Dauerbetrieb eine verifizierte eigene Domain eintragen.
  const from = env.FEEDBACK_FROM_EMAIL?.trim() || "MiniJob Companion <onboarding@resend.dev>";
  if (!apiKey || !to || !isPlainEmail(to)) return null;
  const fromAddress = /<([^<>]+)>$/.exec(from)?.[1] ?? from;
  if (!isPlainEmail(fromAddress) || /[\r\n]/.test(from)) return null;
  return { apiKey, to, from };
}

/**
 * Der Text muss bei gleicher Formular-ID byte-gleich bleiben (kein Zeitstempel): Resend beantwortet
 * dieselbe Idempotenz-Kennung mit anderem Inhalt mit 409, die Wiederholung nach einem Timeout würde sonst
 * nie bestätigt. Das Datum steht ohnehin im E-Mail-Header.
 */
function buildText(
  input: { message: string; appVersion: string; lang: string; route: string; submissionId: string },
  email: string | undefined,
): string {
  return [
    "Neue Nachricht aus MiniJob Companion",
    "",
    cleanMessage(input.message),
    "",
    "---",
    `Antwort an: ${email ?? "(keine E-Mail-Adresse im Konto)"}`,
    `App-Version: ${input.appVersion}`,
    `Sprache: ${input.lang}`,
    `Seite: ${input.route}`,
    `Formular-ID: ${input.submissionId}`,
  ].join("\n");
}

export async function handleFeedback(raw: unknown, deps: FeedbackDeps): Promise<FeedbackResult> {
  if (!deps.user.id) throw new FeedbackError("unauthenticated");
  if (deps.user.isAnonymous) throw new FeedbackError("forbidden"); // anonyme Supabase-Sitzung
  const input = parseFeedbackInput(raw);

  if (deps.sent?.has(input.submissionId)) return { ok: true, duplicate: true };

  if (!deps.config) {
    deps.log?.("feedback.not-configured", {});
    throw new FeedbackError("unavailable");
  }

  const decision = deps.rateLimiter.consume(deps.user.id);
  if (!decision.allowed) {
    deps.log?.("feedback.rate-limited", {});
    throw new FeedbackError("rate_limited", decision.retryAfterSeconds);
  }

  const replyTo = deps.user.email && isPlainEmail(deps.user.email) ? deps.user.email : undefined;
  let result: MailResult;
  try {
    result = await (deps.send ?? ((m, c) => sendMail(m, { apiKey: c.apiKey })))(
      {
        from: deps.config.from,
        to: deps.config.to,
        subject: SUBJECT,
        text: buildText(input, replyTo),
        replyTo,
        idempotencyKey: `feedback-${input.submissionId}`,
      },
      deps.config,
    );
  } catch {
    deps.log?.("feedback.send-threw", {});
    throw new FeedbackError("unavailable");
  }
  if (!result.ok) {
    deps.log?.("feedback.send-failed", { reason: result.reason });
    throw new FeedbackError("unavailable");
  }
  deps.sent?.add(input.submissionId);
  return { ok: true, duplicate: false };
}
