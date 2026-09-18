/**
 * Document i18n — ALWAYS German, independent of UI language.
 *
 * UI routes keep using `t()` / `useT()` from `@/lib/i18n`.
 * PDF / Excel / CSV exports, Arbeitsnachweis, Leistungsnachweis,
 * Jahresbericht and related filenames/columns/signatures use `td()` only.
 */
import { LOCALES, tl, type Vars } from "@/lib/i18n";

/** Fixed document language (never follows settings.language). */
export const DOCUMENT_LANG = "de" as const;

/** BCP 47 locale for dates, currency and month/weekday names inside documents. */
export const DOCUMENT_LOCALE = LOCALES[DOCUMENT_LANG]; // de-DE

/**
 * Translate a key for generated documents. Always resolves German strings
 * from the shared i18n bundle — never the current UI locale.
 */
export function td(key: string, vars?: Vars): string {
  return tl(DOCUMENT_LANG, key, vars);
}

/** German display label for a Dokumente hub / generated-doc category key. */
export function documentCategoryLabel(category: string): string {
  return td(`doc.cat.${category}`);
}
