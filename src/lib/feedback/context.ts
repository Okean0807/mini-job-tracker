import { FEEDBACK_LANGS } from "./schema";

/**
 * Die einzigen technischen Angaben, die mit einem Feedback gesendet werden.
 * Nichts davon stammt aus den App-Daten (keine Schichten, Jobs, Sätze, Konten, Tokens).
 */
export function feedbackContext(
  pathname: string,
  version: string | undefined,
  lang: string,
): { route: string; appVersion: string; lang: (typeof FEEDBACK_LANGS)[number] } {
  const route = pathname
    .toLowerCase()
    .replace(/[^a-z0-9_\-/]/g, "")
    .slice(0, 64);
  const appVersion = (version ?? "").replace(/[^A-Za-z0-9._+-]/g, "").slice(0, 32);
  return {
    route: /^\/[a-z0-9_\-/]{0,63}$/.test(route) ? route : "/",
    appVersion: appVersion || "unknown",
    lang: (FEEDBACK_LANGS as readonly string[]).includes(lang)
      ? (lang as (typeof FEEDBACK_LANGS)[number])
      : "de",
  };
}
