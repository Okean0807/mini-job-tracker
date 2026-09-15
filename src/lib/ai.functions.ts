import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  ASK_GATEWAY_TIMEOUT_MESSAGE,
  ASK_GATEWAY_TIMEOUT_MS,
  isAbortOrTimeoutError,
} from "@/lib/ai-ask";
import { AiGuardError, assertRateLimit, parseAskAssistantInput } from "@/lib/ai-guard";

export const askAssistant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => parseAskAssistantInput(input))
  .handler(async ({ data, context }) => {
    // Rate-Limit strikt pro authentifiziertem Nutzer (userId stammt aus dem verifizierten Token).
    assertRateLimit(context.userId);

    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) throw new AiGuardError("unavailable", "KI ist derzeit nicht verfügbar.");

    let response: Response;
    try {
      // AbortSignal.timeout: without this, a hung Lovable gateway leaves the
      // client stuck on «Der Assistent denkt nach …» forever (busy never clears).
      response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(ASK_GATEWAY_TIMEOUT_MS),
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            {
              role: "system",
              content:
                `Du bist der KI-Assistent der App MiniJob Tracker. Antworte immer auf ${data.language ?? "Deutsch"}, kurz, freundlich und konkret. ` +
                "Du erhältst die Arbeitszeit-Daten des Nutzers als JSON-Zusammenfassung. Rechne sorgfältig, nenne Zahlen mit Einheit " +
                "(Stunden bzw. Euro) und weise auf Trends, Muster oder die Minijob-Grenze hin. Für Prognosen nutze Durchschnitte der " +
                "vorhandenen Monate und kennzeichne sie als Schätzung. Wenn Daten fehlen, sage das offen.",
            },
            { role: "user", content: `Datenbasis:\n${data.context}\n\nFrage: ${data.question}` },
          ],
        }),
      });
    } catch (error) {
      if (error instanceof AiGuardError) throw error;
      // Netzwerk-/Timeout-/Provider-Details bleiben serverseitig, nach außen nur eine generische Meldung.
      if (isAbortOrTimeoutError(error)) {
        throw new AiGuardError("unavailable", ASK_GATEWAY_TIMEOUT_MESSAGE);
      }
      throw new AiGuardError("unavailable", "Die KI konnte nicht antworten.");
    }

    if (response.status === 429)
      throw new AiGuardError("rate_limited", "Zu viele Anfragen – bitte kurz warten.");
    if (response.status === 402)
      throw new AiGuardError("unavailable", "KI-Guthaben aufgebraucht.");
    if (!response.ok) throw new AiGuardError("unavailable", "Die KI konnte nicht antworten.");

    const json = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    return { answer: json.choices?.[0]?.message?.content ?? "Keine Antwort erhalten." };
  });
