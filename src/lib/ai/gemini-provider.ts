import {
  ASK_GATEWAY_TIMEOUT_MESSAGE,
  ASK_GATEWAY_TIMEOUT_MS,
  isAbortOrTimeoutError,
} from "@/lib/ai-ask";
import {
  AI_PROVIDER_STATUSES,
  AiGuardError,
  type AiErrorDiag,
  type AiProviderStatus,
} from "@/lib/ai-guard";
import type { AIProvider, AskRequest, AskResponse, AskSource } from "@/lib/ai/types";

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_MODEL = "gemini-3.6-flash";

export const GROUNDING_UNAVAILABLE_NOTE =
  "Hinweis: Die aktuelle Web-Prüfung ist momentan nicht verfügbar. " +
  "Die folgende Antwort basiert nur auf den gespeicherten Daten bzw. dem Modellwissen.";

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

/**
 * Gemini 3.x models think by default (MEDIUM/HIGH), which can push a single
 * generateContent call past the 30 s server budget. `thinkingLevel: "low"` is the
 * documented low-latency setting for that family. Other model families get no
 * thinkingConfig, so their request stays exactly as before (and cannot 400 on an
 * unsupported field).
 */
export function buildGenerationConfig(model: string): Record<string, unknown> | undefined {
  const id = normalizeGeminiModelId(model);
  if (/^gemini-3([.-]|$)/.test(id)) {
    return { thinkingConfig: { thinkingLevel: "low" } };
  }
  return undefined;
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

export function buildSystemInstruction(language: string): string {
  return (
    `Du bist ein informationaler Arbeitsberater in der App MiniJob Tracker (Themen: Minijob, Arbeitszeit, Lohn, Urlaub, Krankheit, Feiertage, Arbeitsrecht, Mindestlohn, Verdienstgrenzen). ` +
    `Antworte immer auf ${language}, klar und konkret. ` +
    "Du bist KEIN Anwalt und gibst keine Rechtsberatung. Unterscheide ausdrücklich zwischen allgemeiner Information und rechtlicher Beratung. " +
    "Erfinde niemals Gesetze, Paragraphen, Grenzwerte, Urteile oder URLs. " +
    "Wenn dir Suchergebnisse bereitgestellt werden, stütze aktuelle Grenzwerte und Rechtsangaben bevorzugt darauf und nenne nur URLs aus diesen Ergebnissen. " +
    "Bevorzuge Tier1-offizielle Quellen; bei Widersprüchen zuerst offizielle Behördenquellen, dann die frischere Angabe. Social/UGC nie als primäre Rechtsgrundlage. " +
    "Behaupte niemals „web-geprüft“ / „aktuell geprüft“, wenn keine Suchergebnisse vorliegen. " +
    "Wenn Suchergebnisse vorliegen, strukturiere die Antwort idealerweise mit: 🌐 Aktuell geprüft (oder 🔎 Aktuelle Information), 📊 Deine Daten (wenn Nutzer-Stunden/Verdienst in der Datenbasis vorkommen), 📈 Einschätzung. " +
    "Wenn keine Suchergebnisse vorliegen, kennzeichne Unsicherheit offen und erfinde keine Quellen. " +
    "Unterscheide bundesweite Regeln von betrieblichen/tariflichen Regelungen. " +
    "Du erhältst die Arbeitszeit-Daten des Nutzers als JSON-Zusammenfassung: nutze sie für persönliche Berechnungen, nenne Zahlen mit Einheit (Stunden bzw. Euro) und weise auf Trends, Muster oder die Minijob-Grenze hin. " +
    "Für jeden Vergleich mit der Minijob-Grenze verwende ausschließlich minijobEarnings/minijobHours; earnings/hours umfassen alle Jobs inklusive Hauptbeschäftigung. " +
    "Wenn multipleMinijobsWithMainJob true ist (Hauptbeschäftigung plus mehrere Minijobs), bewerte minijobEarnings NICHT eindeutig als „über“ oder „unter“ der Grenze: neben einer Hauptbeschäftigung bleibt in der Regel nur der zuerst aufgenommene Minijob geringfügig, weitere werden mit der Hauptbeschäftigung zusammengerechnet. Weise darauf hin und empfiehl eine Prüfung (z. B. Minijob-Zentrale oder Krankenkasse). " +
    "Wenn minijobActivityUncertain true ist, lässt sich anhand der Daten nicht sicher bestimmen, ob mehrere Minijobs neben der Hauptbeschäftigung gleichzeitig ausgeübt wurden: sage ausdrücklich, dass sich nicht bestimmen lässt, ob die Minijob-Grenze überschritten wurde, und bewerte minijobEarnings nicht als „über“ oder „unter“. " +
    "months und historicalYears sind Gesamtsummen ALLER Jobs (inklusive Hauptbeschäftigung); jobs enthält Gesamtsummen je einzelnem Job über alle Zeiträume (nicht nach Monat oder Jahr aufgeteilt, daher nicht grenzrelevant). " +
    "Historischer Gesamtverdienst ist KEIN Minijob-Einkommen: stelle ihn niemals als Minijob-Verdienst dar und ziehe daraus keinen kategorischen Schluss, die Minijob-Grenze sei überschritten oder eingehalten. " +
    "Für vergangene Monate und Jahre liegt kein grenzrelevanter Minijob-Wert vor. Wenn für einen Zeitraum kein getrennter Minijob-Wert (minijobEarnings) vorliegt, sage ausdrücklich, dass sich anhand dieser Daten nicht bestimmen lässt, ob die Minijob-Grenze überschritten wurde. " +
    "Datenbasis der Summen: currentMonth.hours, currentMonth.earnings, currentMonth.entriesCount, year.hours, year.earnings, das laufende Jahr in historicalYears, der aktuelle und spätere Monate in months sowie jobs können auch Einträge enthalten, die nach currentDate datiert sind. " +
    "Diese Werte geben die in der App erfassten Einträge wieder, nicht zwingend bereits geleistete Arbeit oder bereits erhaltenes Geld. " +
    "Beschreibe nach currentDate datierte Einträge niemals als erledigte Arbeit oder als erhaltenes Einkommen. " +
    "currentMonth.minijobEarnings, currentMonth.minijobHours, year.minijobEarnings und year.minijobHours berücksichtigen nur Einträge mit Datum bis einschließlich currentDate. " +
    "hours sind gearbeitete Stunden; earnings können auch Vergütung für Abwesenheiten enthalten. Gehe nicht davon aus, dass beide Felder dieselbe Grundlage haben. " +
    "Treffen die Kennzeichen multipleMinijobsWithMainJob oder minijobActivityUncertain zu, triff aus den betroffenen Minijob-Werten keine endgültige Aussage zum Stand der Minijob-Grenze. " +
    "Schätze, ergänze oder folgere keinen geplanten Minijob-Verdienst, auch nicht aus expectedAdditional. " +
    "Wenn aus den Daten nicht hervorgeht, ob ein Eintrag geplant oder bereits erledigt ist, sage das ausdrücklich und rate nicht. " +
    "Für Prognosen nutze Durchschnitte der vorhandenen Monate und kennzeichne sie als Schätzung. Wenn Daten fehlen, sage das offen. " +
    "Formatierung: einfaches Markdown (fett, Listen). Verwende kein LaTeX und keine Formel-Syntax wie $$…$$, \\(…\\), \\text{…} oder \\frac; schreibe Rechnungen als Klartext, z. B. „Betrag ÷ Tage × Tage ≈ Ergebnis“."
  );
}

type GeminiGroundingChunk = {
  web?: { uri?: string; title?: string };
};

type GeminiGenerateResponse = {
  /** Prompt-level filter result: when `blockReason` is set the prompt was blocked (no candidates). */
  promptFeedback?: { blockReason?: string };
  candidates?: Array<{
    /** Why generation stopped; only present once the model stopped producing tokens. */
    finishReason?: string;
    content?: { parts?: Array<{ text?: string }> };
    groundingMetadata?: {
      groundingChunks?: GeminiGroundingChunk[];
    };
  }>;
  error?: { message?: string; status?: string; code?: number };
};

/** Extract sources from groundingMetadata — never invent citations. Kept for tests/compat; production sources come from Tavily. */
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

/** Provider credential / configuration failure: not actionable for the user, so deliberately not "login". */
export const PROVIDER_UNAVAILABLE_MESSAGE =
  "Die KI ist momentan nicht verfügbar. Bitte später erneut versuchen.";
/** HTTP 200 whose text is empty (no candidate, no parts or only whitespace). */
export const EMPTY_RESPONSE_MESSAGE =
  "Die KI hat keine Antwort geliefert. Bitte versuche es erneut.";
/** Prompt or candidate blocked by the provider; deliberately names no reason. */
export const BLOCKED_RESPONSE_MESSAGE =
  "Die KI konnte diese Anfrage nicht beantworten. Bitte formuliere sie anders oder stelle eine andere Frage.";
/**
 * Candidate finishReason OTHER: the reference lists it without a documented meaning, so it is
 * neither presented as a successful answer nor blamed on the user's wording.
 */
export const INCOMPLETE_RESPONSE_MESSAGE =
  "Die KI hat keine vollständige Antwort geliefert. Bitte versuche es erneut.";
/** MAX_TOKENS without any usable text. */
export const TRUNCATED_EMPTY_MESSAGE =
  "Die Antwort der KI wurde vorzeitig abgebrochen. Bitte stelle die Frage kürzer oder genauer.";
/** Placed before a MAX_TOKENS answer that still contains text. */
export const TRUNCATED_ANSWER_NOTE =
  "Hinweis: Die Antwort der KI wurde möglicherweise abgebrochen und ist eventuell unvollständig.";

/**
 * Candidate `finishReason` values that mean the content was withheld or not produced normally
 * (Gemini API reference, FinishReason enum). IMAGE_RECITATION is deliberately absent: it could
 * not be confirmed from the reference text available when this was written. OTHER is handled
 * separately (see INCOMPLETE_RESPONSE_MESSAGE); a prompt-level blockReason of any value,
 * including OTHER, is a documented block.
 */
const BLOCKING_FINISH_REASONS: ReadonlySet<string> = new Set([
  "SAFETY",
  "BLOCKLIST",
  "PROHIBITED_CONTENT",
  "SPII",
  "IMAGE_SAFETY",
  "IMAGE_PROHIBITED_CONTENT",
  "RECITATION",
  "LANGUAGE",
]);
/** Normal completion; an absent finishReason is treated the same way. */
const NORMAL_FINISH_REASONS: ReadonlySet<string> = new Set(["STOP"]);

/**
 * Allowlisted `error.status` of a provider error body (Google API status vocabulary).
 * Returns undefined when the body has none; unknown tokens become OTHER. Never returns text.
 */
export function providerStatusFromBody(bodyText: string): AiProviderStatus | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object") return undefined;
  const error = (parsed as { error?: unknown }).error;
  if (!error || typeof error !== "object") return undefined;
  const status = (error as { status?: unknown }).status;
  if (typeof status !== "string") return undefined;
  return (AI_PROVIDER_STATUSES as readonly string[]).includes(status)
    ? (status as AiProviderStatus)
    : "OTHER";
}

/** Map Gemini HTTP failures to safe user-facing AiGuardError — never include API key, env names, or raw body. */
export function mapHttpError(status: number, bodyText: string): AiGuardError {
  const providerStatus = providerStatusFromBody(bodyText);
  const diag = (cause: AiErrorDiag["cause"]): AiErrorDiag => ({
    cause,
    httpStatus: status,
    ...(providerStatus ? { providerStatus } : {}),
  });
  if (status === 401) {
    return new AiGuardError("unavailable", PROVIDER_UNAVAILABLE_MESSAGE, diag("provider_auth"));
  }
  if (status === 429) {
    return new AiGuardError(
      "rate_limited",
      "Zu viele Anfragen oder Kontingent erschöpft – bitte kurz warten.",
      diag("provider_rate_limited"),
    );
  }
  if (status === 403) {
    const lower = bodyText.toLowerCase();
    if (lower.includes("quota") || lower.includes("billing") || lower.includes("free")) {
      return new AiGuardError(
        "unavailable",
        "KI-Kontingent aufgebraucht oder Zugriff gesperrt. Bitte später erneut versuchen.",
        diag("provider_quota"),
      );
    }
    return new AiGuardError(
      "unavailable",
      "KI-Zugriff derzeit nicht möglich. Bitte später erneut versuchen.",
      diag("provider_forbidden"),
    );
  }
  if (status === 404) {
    return new AiGuardError(
      "unavailable",
      "KI-Dienst vorübergehend nicht erreichbar. Bitte später erneut versuchen.",
      diag("provider_model_not_found"),
    );
  }
  if (status === 400) {
    if (/quota|RESOURCE_EXHAUSTED/i.test(bodyText)) {
      return new AiGuardError(
        "unavailable",
        "KI-Kontingent aufgebraucht. Bitte später erneut versuchen.",
        diag("provider_quota"),
      );
    }
    // Only a key-related 400 is a credential problem; a bare INVALID_ARGUMENT is a bad request.
    if (/API_KEY|API key/i.test(bodyText)) {
      return new AiGuardError("unavailable", PROVIDER_UNAVAILABLE_MESSAGE, diag("provider_auth"));
    }
    return new AiGuardError(
      "unavailable",
      "Die KI konnte nicht antworten. Bitte später erneut versuchen.",
      diag("provider_bad_request"),
    );
  }
  return new AiGuardError(
    "unavailable",
    "Die KI konnte nicht antworten. Bitte später erneut versuchen.",
    diag(status >= 500 ? "provider_server_error" : "provider_http_error"),
  );
}

/** Append clear note when web verification / grounding is unavailable. */
export function withGroundingUnavailableNote(response: AskResponse): AskResponse {
  if (
    response.answer.includes("Web-Prüfung ist momentan nicht verfügbar") ||
    response.answer.includes("Web-Prüfung ist vorübergehend nicht verfügbar")
  ) {
    return response;
  }
  const answer = `${response.answer.trim()}\n\n${GROUNDING_UNAVAILABLE_NOTE}`;
  const degraded = response.degraded ? { degraded: response.degraded } : {};
  if (response.sources && response.sources.length > 0) {
    return { answer, sources: response.sources, ...degraded };
  }
  return { answer, ...degraded };
}

/** Gemini reasoning provider — generateContent only, no tools or Google Search grounding. */
export class GeminiProvider implements AIProvider {
  async ask(req: AskRequest, opts?: { signal?: AbortSignal }): Promise<AskResponse> {
    const { apiKey, model } = resolveGeminiConfig();
    if (!apiKey) {
      throw new AiGuardError("unavailable", "KI ist derzeit nicht verfügbar.", {
        cause: "no_api_key",
      });
    }

    const language = req.language?.trim() || "Deutsch";
    const userText = `Datenbasis:\n${req.context}\n\nFrage: ${req.question}`;
    const signal = opts?.signal ?? AbortSignal.timeout(ASK_GATEWAY_TIMEOUT_MS);

    try {
      return await this.generate(apiKey, model, language, userText, signal);
    } catch (error) {
      if (isAiGuardErrorLike(error)) throw error;
      if (isAbortOrTimeoutError(error)) {
        throw new AiGuardError("unavailable", ASK_GATEWAY_TIMEOUT_MESSAGE, {
          cause: "provider_timeout",
        });
      }
      throw new AiGuardError("unavailable", "Die KI konnte nicht antworten.", {
        cause: "provider_error",
      });
    }
  }

  private async generate(
    apiKey: string,
    model: string,
    language: string,
    userText: string,
    signal: AbortSignal,
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
    const generationConfig = buildGenerationConfig(model);
    if (generationConfig) body["generationConfig"] = generationConfig;

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
      throw new AiGuardError("unavailable", "Die KI konnte nicht antworten.", {
        cause: "provider_network",
      });
    }

    const bodyText = await response.text();

    if (!response.ok) {
      throw mapHttpError(response.status, bodyText);
    }

    const parseError = (): AiGuardError =>
      new AiGuardError("unavailable", "Die KI konnte nicht antworten.", {
        cause: "provider_parse_error",
        httpStatus: response.status,
      });

    let parsed: unknown;
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      throw parseError();
    }
    // A successful HTTP status with an unexpected structure must never become a silent empty answer.
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw parseError();
    const json = parsed as GeminiGenerateResponse;
    if (json.candidates !== undefined && !Array.isArray(json.candidates)) throw parseError();
    const candidate = json.candidates?.[0];
    const parts = candidate?.content?.parts;
    if (parts !== undefined && !Array.isArray(parts)) throw parseError();

    const blocked = (): AiGuardError =>
      new AiGuardError("unavailable", BLOCKED_RESPONSE_MESSAGE, {
        cause: "provider_blocked",
        httpStatus: response.status,
      });

    // Prompt-level block: no candidates are returned. BLOCK_REASON_UNSPECIFIED is documented as unused.
    const blockReason = json.promptFeedback?.blockReason;
    if (
      typeof blockReason === "string" &&
      blockReason !== "" &&
      blockReason !== "BLOCK_REASON_UNSPECIFIED"
    ) {
      throw blocked();
    }

    const finishReason =
      typeof candidate?.finishReason === "string" ? candidate.finishReason : undefined;
    const answer = (parts ?? [])
      .map((p) => (p && typeof p.text === "string" ? p.text : ""))
      .join("")
      .trim();

    // Blocked content is never a success, even if some text was produced before the block.
    if (finishReason !== undefined && BLOCKING_FINISH_REASONS.has(finishReason)) throw blocked();

    // Undocumented meaning: fail closed (even with partial text) without guessing a cause.
    if (finishReason === "OTHER") {
      throw new AiGuardError("unavailable", INCOMPLETE_RESPONSE_MESSAGE, {
        cause: "provider_other_finish",
        httpStatus: response.status,
      });
    }

    if (finishReason === "MAX_TOKENS") {
      if (!answer) {
        throw new AiGuardError("unavailable", TRUNCATED_EMPTY_MESSAGE, {
          cause: "provider_truncated",
          httpStatus: response.status,
        });
      }
      // Warning first: the chat history keeps only the first characters of a long message.
      return { answer: `${TRUNCATED_ANSWER_NOTE}\n\n${answer}`, degraded: "truncated" };
    }

    if (!answer) {
      const providerStatus = providerStatusFromBody(bodyText);
      throw new AiGuardError("unavailable", EMPTY_RESPONSE_MESSAGE, {
        cause: "provider_empty",
        httpStatus: response.status,
        ...(providerStatus ? { providerStatus } : {}),
      });
    }

    // STOP, no finishReason, or a value this code does not know: the text is kept unchanged.
    // Unknown values are flagged for diagnostics only (the value itself is never logged).
    if (finishReason !== undefined && !NORMAL_FINISH_REASONS.has(finishReason)) {
      return { answer, degraded: "unexpected_finish" };
    }

    // Production path does not use Gemini grounding; ignore any residual metadata.
    return { answer };
  }
}
