/**
 * Versand über die Resend-REST-API (https://resend.com/docs/api-reference/emails/send-email) – ohne
 * zusätzliche Abhängigkeit, nur `fetch`. Läuft ausschließlich auf dem Server; der API-Schlüssel steht
 * nur in der Server-Umgebung und wird nie protokolliert oder in Fehlern zurückgegeben.
 */
export interface MailMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
  replyTo?: string | undefined;
  /** Gleicher Schlüssel = der Dienst sendet dieselbe Nachricht nicht zweimal. */
  idempotencyKey: string;
}

export type MailResult = { ok: true; id: string } | { ok: false; reason: string };

export interface MailerOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export const RESEND_DEFAULT_URL = "https://api.resend.com";

/**
 * „ok“ nur, wenn der Dienst die Annahme bestätigt hat: HTTP 2xx UND eine Nachrichten-ID im JSON.
 * `reason` enthält nie Antworttexte, Schlüssel oder Adressen (nur eine Kurzkennung wie `http-403`).
 */
export async function sendMail(message: MailMessage, options: MailerOptions): Promise<MailResult> {
  const doFetch = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await doFetch(`${options.baseUrl ?? RESEND_DEFAULT_URL}/emails`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": message.idempotencyKey,
      },
      body: JSON.stringify({
        from: message.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        ...(message.replyTo ? { reply_to: message.replyTo } : {}),
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 8_000),
    });
  } catch (error) {
    const timedOut =
      error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    return { ok: false, reason: timedOut ? "timeout" : "network" };
  }
  if (!response.ok) return { ok: false, reason: `http-${response.status}` };
  try {
    const body = (await response.json()) as { id?: unknown };
    return typeof body.id === "string" && body.id !== ""
      ? { ok: true, id: body.id }
      : { ok: false, reason: "no-id" };
  } catch {
    return { ok: false, reason: "bad-response" };
  }
}
