import {
  ASK_GATEWAY_TIMEOUT_MESSAGE,
  ASK_GATEWAY_TIMEOUT_MS,
  isAbortOrTimeoutError,
} from "@/lib/ai-ask";
import { AiGuardError } from "@/lib/ai-guard";
import type { AIProvider } from "@/lib/ai/provider";
import type { AskRequest, AskResponse, AskSource } from "@/lib/ai/types";

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_MODEL = "gemini-3.6-flash";

export const GROUNDING_UNAVAILABLE_NOTE =
  "Hinweis: Eine aktuelle Web-Prüfung ist vorübergehend nicht verfügbar. " +
  "Behandle Angaben zu gesetzlichen Grenzen und aktuellem Recht als allgemeine Orientierung, nicht als verbindliche Auskunft.";

/** Strip surrounding quotes often introduced by Vercel/env paste mistakes. */
function normalizeEnvSecret(raw: string): string {
  let value = raw.trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1).trim();
  }
  return value;
}

/** Deprecated Gemini model ids that 404 for new API users → current replacements. */
const DEPRECATED_GEMINI_MODEL_REMAP: Record<string, string> = {
  "gemini-2.5-flash": "gemini-3.6-flash",
  "gemini-2.5-flash-lite": "gemini-3.5-flash-lite",
};

/**
 * Normalize GEMINI_MODEL: trim, strip surrounding quotes, strip a single
 * leading `models/` prefix, remap deprecated ids. Empty after sanitize → DEFAULT_MODEL.
 */
export function normalizeGeminiModelId(raw: string | undefined): string {
  if (typeof raw !== "string") return DEFAULT_MODEL;
  let value = normalizeEnvSecret(raw);
  if (value.startsWith("models/")) {
    value = value.slice("models/".length).trim();
  }
  if (!value) return DEFAULT_MODEL;
  return DEPRECATED_GEMINI_MODEL_REMAP[value] ?? value;
}

/** Build generateContent URL — never double `models/` or append `:generateContent` twice. */
export function buildGenerateContentUrl(model: string): string {
  const id = normalizeGeminiModelId(model);
  return `${GEMINI_API_BASE}/${encodeURIComponent(id)}:generateContent`;
}

/** Single config helper — never log or return the API key. */
export function resolveGeminiConfig(env: Record<string, string | undefined> = process.env): {
  apiKey: string | undefined;
  model: string;
} {
  const rawKey = env["GEMINI_API_KEY"];
  let apiKey: string | undefined;
  if (typeof rawKey === "string") {
    const normalized = normalizeEnvSecret(rawKey);
    apiKey = normalized ? normalized : undefined;
  }
  const model = normalizeGeminiModelId(env["GEMINI_MODEL"]);
  return { apiKey, model };
}

function buildSystemInstruction(language: string): string {
  return (
    `Du bist ein informationaler Arbeitsberater in der App MiniJob Tracker (Themen: Minijob, Arbeitszeit, Lohn, Urlaub, Krankheit, Feiertage, Arbeitsrecht, Mindestlohn, Verdienstgrenzen). ` +
    `Antworte immer auf ${language}, klar und konkret. ` +
    "Du bist KEIN Anwalt und gibst keine Rechtsberatung. Unterscheide ausdrücklich zwischen allgemeiner Information und rechtlicher Beratung. " +
    "Erfinde niemals Gesetze, Paragraphen, Grenzwerte oder Urteile. Für sich ändernde Limits und aktuelles Recht nutze die Web-Suche (Google Search Grounding) und bevorzugt deutsche Quellen (z. B. minijob-zentrale.de, bmas.de, gesetze-im-internet.de). " +
    "Kennzeichne Unsicherheit offen. Unterscheide bundesweite Regeln von betrieblichen/tariflichen Regelungen. " +
    "Du erhältst die Arbeitszeit-Daten des Nutzers als JSON-Zusammenfassung: nutze sie für persönliche Berechnungen, nenne Zahlen mit Einheit (Stunden bzw. Euro) und weise auf Trends, Muster oder die Minijob-Grenze hin. " +
    "Für Prognosen nutze Durchschnitte der vorhandenen Monate und kennzeichne sie als Schätzung. Wenn Daten fehlen, sage das offen."
  );
}

type GeminiGroundingChunk = {
  web?: { uri?: string; title?: string };
};

type GeminiGenerateResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    groundingMetadata?: {
      groundingChunks?: GeminiGroundingChunk[];
    };
  }>;
  error?: { message?: string; status?: string; code?: number };
};

/** Extract sources from groundingMetadata — never invent citations. */
export function extractSourcesFromGrounding(metadata: unknown): AskSource[] {
  if (!metadata || typeof metadata !== "object") return [];
  const chunks = (metadata as { groundingChunks?: unknown }).groundingChunks;
  if (!Array.isArray(chunks)) return [];

  const seen = new Set<string>();
  const sources: AskSource[] = [];
  for (const chunk of chunks) {
    if (!chunk || typeof chunk !== "object") continue;
    const web = (chunk as GeminiGroundingChunk).web;
    if (!web || typeof web !== "object") continue;
    const uri = typeof web.uri === "string" ? web.uri.trim() : "";
    if (!uri || seen.has(uri)) continue;
    seen.add(uri);
    const title = typeof web.title === "string" ? web.title.trim() : "";
    if (title) {
      sources.push({ url: uri, title });
    } else {
      sources.push({ url: uri });
    }
  }
  return sources;
}

function isAiGuardErrorLike(error: unknown): error is AiGuardError {
  return (
    error instanceof AiGuardError ||
    (typeof error === "object" &&
      error !== null &&
      (error as { name?: string }).name === "AiGuardError")
  );
}

/** Map Gemini HTTP failures to safe user-facing AiGuardError — never include API key or raw body. */
export function mapHttpError(status: number, bodyText: string): AiGuardError {
  if (status === 401) {
    return new AiGuardError(
      "unavailable",
      "API-Schlüssel ungültig oder nicht autorisiert.",
    );
  }
  if (status === 429) {
    return new AiGuardError(
      "rate_limited",
      "Zu viele Anfragen oder Kontingent erschöpft – bitte kurz warten.",
    );
  }
  if (status === 403) {
    const lower = bodyText.toLowerCase();
    if (lower.includes("quota") || lower.includes("billing") || lower.includes("free")) {
      return new AiGuardError(
        "unavailable",
        "KI-Kontingent (Free Tier) aufgebraucht oder API-Zugriff gesperrt. Bitte später erneut versuchen.",
      );
    }
    return new AiGuardError(
      "unavailable",
      "KI-Zugriff verweigert (API-Schlüssel oder Kontingent). Bitte Konfiguration prüfen.",
    );
  }
  if (status === 404) {
    return new AiGuardError(
      "unavailable",
      "Model oder Endpoint nicht gefunden. Prüfe GEMINI_MODEL.",
    );
  }
  if (status === 400) {
    if (/quota|RESOURCE_EXHAUSTED/i.test(bodyText)) {
      return new AiGuardError(
        "unavailable",
        "KI-Kontingent (Free Tier) aufgebraucht. Bitte später erneut versuchen.",
      );
    }
    if (/API_KEY|API key|invalid.?argument|INVALID_ARGUMENT/i.test(bodyText)) {
      return new AiGuardError(
        "unavailable",
        "Ungültige KI-Anfrage (Schlüssel oder Argumente).",
      );
    }
  }
  return new AiGuardError("unavailable", `Die KI konnte nicht antworten. (HTTP ${status})`);
}

/** Append clear note when web verification / grounding is unavailable. */
export function withGroundingUnavailableNote(response: AskResponse): AskResponse {
  if (response.answer.includes("Web-Prüfung ist vorübergehend nicht verfügbar")) {
    return response;
  }
  const answer = `${response.answer.trim()}\n\n${GROUNDING_UNAVAILABLE_NOTE}`;
  if (response.sources && response.sources.length > 0) {
    return { answer, sources: response.sources };
  }
  return { answer };
}

export class GeminiProvider implements AIProvider {
  async ask(req: AskRequest, opts?: { signal?: AbortSignal }): Promise<AskResponse> {
    const { apiKey, model } = resolveGeminiConfig();
    if (!apiKey) {
      throw new AiGuardError("unavailable", "KI ist derzeit nicht verfügbar.");
    }

    const language = req.language?.trim() || "Deutsch";
    const userText = `Datenbasis:\n${req.context}\n\nFrage: ${req.question}`;
    const signal = opts?.signal ?? AbortSignal.timeout(ASK_GATEWAY_TIMEOUT_MS);

    try {
      return await this.generate(apiKey, model, language, userText, signal, true);
    } catch (error) {
      if (isAiGuardErrorLike(error)) throw error;
      if (isAbortOrTimeoutError(error)) {
        throw new AiGuardError("unavailable", ASK_GATEWAY_TIMEOUT_MESSAGE);
      }
      throw new AiGuardError("unavailable", "Die KI konnte nicht antworten.");
    }
  }

  private async generate(
    apiKey: string,
    model: string,
    language: string,
    userText: string,
    signal: AbortSignal,
    withGrounding: boolean,
  ): Promise<AskResponse> {
    const url = buildGenerateContentUrl(model);
    const body: Record<string, unknown> = {
      systemInstruction: {
        parts: [{ text: buildSystemInstruction(language) }],
      },
      contents: [
        {
          role: "user",
          parts: [{ text: userText }],
        },
      ],
    };
    if (withGrounding) {
      body["tools"] = [{ google_search: {} }];
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        signal,
        body: JSON.stringify(body),
      });
    } catch (error) {
      if (isAbortOrTimeoutError(error)) throw error;
      throw new AiGuardError("unavailable", "Die KI konnte nicht antworten.");
    }

    const bodyText = await response.text();

    if (!response.ok) {
      // Always retry once without tools before mapping the HTTP error.
      if (withGrounding) {
        const fallback = await this.generate(apiKey, model, language, userText, signal, false);
        return withGroundingUnavailableNote(fallback);
      }
      throw mapHttpError(response.status, bodyText);
    }

    let json: GeminiGenerateResponse;
    try {
      json = JSON.parse(bodyText) as GeminiGenerateResponse;
    } catch {
      throw new AiGuardError("unavailable", "Die KI konnte nicht antworten.");
    }

    const candidate = json.candidates?.[0];
    const answer =
      candidate?.content?.parts
        ?.map((p) => (typeof p.text === "string" ? p.text : ""))
        .join("")
        .trim() || "Keine Antwort erhalten.";

    const sources = extractSourcesFromGrounding(candidate?.groundingMetadata);

    if (sources.length > 0) {
      return { answer, sources };
    }
    return { answer };
  }
}
