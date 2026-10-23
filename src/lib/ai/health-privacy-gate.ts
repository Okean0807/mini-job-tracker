/**
 * L1 server-side AI privacy gate (R4).
 *
 * Pure, dependency-free detector that blocks PERSONAL health information
 * (own or third-party diagnoses, symptoms, medication, sick-leave details,
 * pregnancy, disability, mental health tied to a person) before anything is
 * sent to an external AI / web-search provider. GENERAL legal / payroll
 * questions ("Lohnfortzahlung im Krankheitsfall", "Krankenversicherung
 * Minijob", "6-Wochen-Regel") must pass.
 *
 * Design constraints:
 * - Deterministic regex heuristics, no network, no logging of content.
 * - Fail closed on malformed / unexpected client context (server never trusts
 *   the client-built context string).
 * - Block only; there is intentionally no warn-and-confirm path.
 *
 * This is a technical safeguard, not a legal assessment.
 */

export const HEALTH_DATA_BLOCKED = "HEALTH_DATA_BLOCKED" as const;
export const CONTEXT_INVALID = "CONTEXT_INVALID" as const;

export type PrivacyGateCode = typeof HEALTH_DATA_BLOCKED | typeof CONTEXT_INVALID;

/** Machine-readable reason (safe to log; never contains request content). */
export type PrivacyGateReason =
  | "question_personal_health"
  | "context_personal_health"
  | "context_malformed"
  | "context_unexpected_shape"
  | "input_malformed";

export type PrivacyGateResult =
  | { allowed: true }
  | { allowed: false; code: PrivacyGateCode; reason: PrivacyGateReason; message: string };

export const HEALTH_DATA_BLOCKED_MESSAGE =
  "Aus Datenschutzgründen kann die KI keine Fragen mit persönlichen Gesundheitsangaben " +
  "(z. B. Diagnosen, Symptome, Medikamente, Krankschreibungsgründe, Schwangerschaft, " +
  "Behinderung) beantworten. Es wurde nichts an den KI-Dienst gesendet. Bitte stelle " +
  "die Frage allgemein, z. B. „Wie funktioniert die Lohnfortzahlung im Krankheitsfall " +
  "im Minijob?“";

export const CONTEXT_INVALID_MESSAGE =
  "Die Anfrage konnte nicht sicher geprüft werden und wurde nicht gesendet. " +
  "Bitte lade die App neu und versuche es erneut.";

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/** Lowercase, fold umlauts / ß, collapse whitespace. */
export function normalizeForGate(input: string): string {
  return input
    .normalize("NFKC")
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[\u2019`´]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Lexicons (all on normalised text: umlauts folded)
// ---------------------------------------------------------------------------

/**
 * Specific conditions / symptoms / treatments / medication. These alone are
 * NOT enough (a general question "Lohnfortzahlung bei Burnout?" passes); they
 * block when tied to a person (personal marker) or a disclosure cue.
 */
const CONDITION_TERMS = [
  // diagnoses / conditions (DE)
  "diagnose", "diagnostiz", "befund", "erkrankung", "krankheitsbild",
  "depression", "depressiv", "burnout", "burn-out", "angststoerung", "panikattacke",
  "psychisch", "psychiatr", "psychosomat", "trauma", "ptbs", "adhs", "autismus",
  "essstoerung", "suchterkrankung", "alkoholkrank", "bipolar", "schizophren",
  "krebs", "tumor", "chemo", "bestrahlung", "diabetes", "asthma", "epilepsie",
  "migraene", "grippe", "influenza", "covid", "corona", "erkaeltung", "infekt",
  "magen-darm", "norovirus", "bronchitis", "lungenentzuendung", "fieber",
  "bandscheibe", "rueckenschmerz", "kopfschmerz", "bauchschmerz", "schmerzen",
  "herzinfarkt", "schlaganfall", "bluthochdruck", "allergie", "long covid",
  "beinbruch", "armbruch", "knochenbruch",
  "gehirnerschuetterung", "sehnenscheide", "kreuzband", "meniskus",
  "operation", "operiert", " op ", "notaufnahme", "reha",
  "therapie", "therapeut", "psychotherap", "physiotherap",
  "medikament", "tabletten", "antidepressiv", "antibiotik", "ibuprofen", "insulin",
  "symptom", "uebelkeit",
  "schwanger", "schwangerschaft", "fehlgeburt", "entbindung",
  "behinderung", "behindert", "schwerbehindert", "gdb ",
  // EN
  "diagnosed", "diagnosis", "depression", "anxiety", "cancer", "flu ", "migraine",
  "surgery", "medication", "therapy", "therapist", "symptom", "pregnan", "disabilit",
  "disabled", "illness", "injury", "injured", "fever",
] as const;

/** Markers that tie a statement to a concrete person (1st or 3rd person). */
const PERSONAL_MARKER_RE = new RegExp(
  [
    // DE first person
    "\\b(ich|mich|mir|mein|meine|meinem|meinen|meiner|meines|wir|uns|unser|unsere|unserem|unseren|unserer)\\b",
    // DE third person tied to a relation
    "\\b(sohn|tochter|kind|kinder|frau|ehefrau|ehemann|partner|partnerin|freund|freundin|mutter|vater|kollege|kollegin|chef|chefin|mitarbeiter|mitarbeiterin)\\s+(ist|war|hat|hatte|wurde|nimmt|bekommt|leidet)\\b",
    "\\b(er|sie)\\s+(ist|war|hat|hatte|wurde|leidet|nimmt)\\b",
    // EN
    "\\b(i|i'm|i've|me|my|mine|we|our)\\b",
    "\\b(he|she)\\s+(is|was|has|had)\\b",
  ].join("|"),
);

/** Disclosure cues that imply a concrete case even without a pronoun. */
const DISCLOSURE_CUE_RE =
  /\b(seit (gestern|heute|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|letzte[rmn]? woche|\d+\s*(tag|tagen|wochen?|monat|monaten)))\b|\bdiagnostiziert\b|\bkrankgeschrieben\b|\bdiagnosed with\b/;

/**
 * Direct personal-health patterns that block on their own (no condition term
 * required). Applied to normalised text.
 */
const DIRECT_PATTERNS: RegExp[] = [
  // "ich bin/war (seit Montag) krank / krankgeschrieben / schwanger / behindert"
  /\b(ich|wir)\s+(bin|war|waren|sind|wurde|wurden)\b[^.?!;]{0,40}?\b(krank|krankgeschrieben|arbeitsunfaehig|schwanger|behindert|schwerbehindert|in therapie|in behandlung|im krankenhaus|operiert)\b/,
  // "ich habe/hatte eine Krankschreibung / AU / Grippe ..."
  /\b(ich|wir)\s+(habe|hatte|hab|haben|hatten|bekomme|bekam|nehme|nahm)\b[^.?!;]{0,40}?\b(krankschreibung|krankmeldung|au-bescheinigung|arbeitsunfaehigkeitsbescheinigung|gelben schein|attest|diagnose|medikament\w*|therapie)\b/,
  // "mein(e) Diagnose / Krankheit / Arzt / Therapie / AU ..."
  /\b(mein|meine|meinem|meinen|meiner|meines|unser|unsere)\s+(\w+\s+)?(diagnose|krankheit|erkrankung|krankschreibung|krankmeldung|au|au-bescheinigung|attest|arzt|aerztin|hausarzt|hausaerztin|facharzt|psychiater\w*|therapeut\w*|therapie|medikament\w*|befund\w*|symptom\w*|schwangerschaft|behinderung|gdb|reha|operation|op|krankenhausaufenthalt|krankheitstage|fehltage)\b/,
  // "AU wegen ...", "krankgeschrieben wegen/mit/bis ...", "krank mit/wegen ..."
  /\bau\s+(wegen|aufgrund|seit)\b/,
  /\bkrankgeschrieben\s+(wegen|aufgrund|mit|bis|vom|seit|von)\b/,
  /\bkrankschreibung\s+(wegen|aufgrund)\b/,
  /\bkrank\s+(mit|wegen|aufgrund)\b/,
  // "mein Kind / meine Frau ist krank / schwanger"
  /\b(mein|meine|meinem|unser|unsere)\s+(sohn|tochter|kind|kinder|frau|ehefrau|mann|ehemann|partner|partnerin|freund|freundin|mutter|vater|kollege|kollegin|chef|chefin)\s+(ist|war|wurde|liegt|hat|hatte)\b[^.?!;]{0,40}?\b(krank|krankgeschrieben|schwanger|im krankenhaus|operiert|diagnose)\b/,
  // "(Kollege|er|sie) ist krankgeschrieben/schwanger"
  /\b(er|sie|kollege|kollegin)\s+(ist|war)\s+(seit\s+\w+\s+)?(krankgeschrieben|schwanger|arbeitsunfaehig)\b/,
  // subordinate clause, non-hypothetical: "weil/da ich krank bin/war"
  /\b(weil|da|nachdem|obwohl)\s+(ich|wir)\s+(\w+\s+){0,4}?(krank|krankgeschrieben|schwanger|arbeitsunfaehig)\s+(bin|war|sind|waren|wurde)\b/,
  // ICD-10 code with decimals ("F32.1", "J06.9") or explicit "ICD"
  /\b[a-z]\d{2}\.\d{1,2}\b/,
  /\bicd(-?10)?\b/,
  // EN
  /\bi\s*(am|'m|was|have been|'ve been)\s+(\w+\s+){0,2}?(sick|ill|pregnant|disabled|in hospital|on sick leave|diagnosed)\b/,
  /\bmy\s+(\w+\s+)?(diagnosis|doctor|gp|therapist|therapy|medication|meds|illness|condition|sick note|sick leave|pregnancy|disability|symptoms?)\b/,
  /\bsick note (for|because|due)\b/,
  /\bdiagnosed with\b/,
];

function containsConditionTerm(text: string): boolean {
  const padded = ` ${text} `;
  return CONDITION_TERMS.some((t) => padded.includes(t));
}

/**
 * True when `text` contains personal health information.
 * Pure and deterministic; never logs.
 */
export function containsPersonalHealthInfo(text: string): boolean {
  if (typeof text !== "string" || text.length === 0) return false;
  const n = normalizeForGate(text);
  if (!n) return false;
  if (DIRECT_PATTERNS.some((re) => re.test(n))) return true;
  if (containsConditionTerm(n) && (PERSONAL_MARKER_RE.test(n) || DISCLOSURE_CUE_RE.test(n))) {
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Context validation (server must not trust the client-built context)
// ---------------------------------------------------------------------------

/**
 * Keys produced by buildAssistantContext (src/lib/minijob/ai-context.ts).
 * Any other key fails closed: a forged or stale context cannot smuggle extra
 * fields (e.g. absence notes) to the provider.
 */
export const ALLOWED_CONTEXT_KEYS: ReadonlySet<string> = new Set([
  "currentDate",
  "settings",
  "hourlyRate",
  "legalMonthlyLimit",
  "automaticMonthlyHours",
  "annualLimit",
  "workMode",
  "minijobLimitApplies",
  "currentMonth",
  "year",
  "month",
  "monthName",
  "hours",
  "earnings",
  "minijobEarnings",
  "minijobHours",
  "multipleMinijobsWithMainJob",
  "minijobActivityUncertain",
  "entriesCount",
  "historicalYears",
  "months",
  "jobs",
  "id",
  "name",
  "mode",
  "employmentType",
]);

const MAX_CONTEXT_DEPTH = 6;
const MAX_CONTEXT_STRING_CHARS = 500;

type WalkOutcome = "ok" | "shape" | "health";

function walkContext(value: unknown, depth: number): WalkOutcome {
  if (depth > MAX_CONTEXT_DEPTH) return "shape";
  if (value === null || typeof value === "number" || typeof value === "boolean") return "ok";
  if (typeof value === "string") {
    if (value.length > MAX_CONTEXT_STRING_CHARS) return "shape";
    return containsPersonalHealthInfo(value) ? "health" : "ok";
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const r = walkContext(item, depth + 1);
      if (r !== "ok") return r;
    }
    return "ok";
  }
  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (!ALLOWED_CONTEXT_KEYS.has(key)) return "shape";
      const r = walkContext(child, depth + 1);
      if (r !== "ok") return r;
    }
    return "ok";
  }
  return "shape";
}

function block(code: PrivacyGateCode, reason: PrivacyGateReason): PrivacyGateResult {
  return {
    allowed: false,
    code,
    reason,
    message: code === HEALTH_DATA_BLOCKED ? HEALTH_DATA_BLOCKED_MESSAGE : CONTEXT_INVALID_MESSAGE,
  };
}

/** Validate + scan the client-supplied context string. Empty context is allowed. */
export function checkContext(context: unknown): PrivacyGateResult {
  if (context === undefined || context === null) return block(CONTEXT_INVALID, "context_malformed");
  if (typeof context !== "string") return block(CONTEXT_INVALID, "context_malformed");
  if (context.trim() === "") return { allowed: true };
  let parsed: unknown;
  try {
    parsed = JSON.parse(context);
  } catch {
    return block(CONTEXT_INVALID, "context_malformed");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return block(CONTEXT_INVALID, "context_unexpected_shape");
  }
  const outcome = walkContext(parsed, 0);
  if (outcome === "shape") return block(CONTEXT_INVALID, "context_unexpected_shape");
  if (outcome === "health") return block(HEALTH_DATA_BLOCKED, "context_personal_health");
  return { allowed: true };
}

/** Full gate: question first, then context. */
export function checkAiPrivacy(input: { question: unknown; context: unknown }): PrivacyGateResult {
  if (typeof input.question !== "string") return block(CONTEXT_INVALID, "input_malformed");
  if (containsPersonalHealthInfo(input.question)) {
    return block(HEALTH_DATA_BLOCKED, "question_personal_health");
  }
  return checkContext(input.context);
}
