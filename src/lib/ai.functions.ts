import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const schema = z.object({
  question: z.string().min(1).max(2000),
  context: z.string().max(20000),
  language: z.string().max(50).optional(),
});

export const askAssistant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => schema.parse(input))
  .handler(async ({ data }) => {
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) throw new Error("KI ist derzeit nicht verfügbar.");

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
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

    if (response.status === 429) throw new Error("Zu viele Anfragen – bitte kurz warten.");
    if (response.status === 402) throw new Error("KI-Guthaben aufgebraucht.");
    if (!response.ok) throw new Error("Die KI konnte nicht antworten.");

    const json = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    return { answer: json.choices?.[0]?.message?.content ?? "Keine Antwort erhalten." };
  });
