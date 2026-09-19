import { getData, useAppData } from "@/lib/minijob/store";

import { LANGUAGES, LOCALES, mergeBundles, type Bundle, type Lang } from "./core";
import { a11y } from "./dict/a11y";
import { annual } from "./dict/annual";
import { assistant } from "./dict/assistant";
import { common } from "./dict/common";
import { dashboard } from "./dict/dashboard";
import { docsDict } from "./dict/docs";
import { entry } from "./dict/entry";
import { goalsDict } from "./dict/goals";
import { ordersDict } from "./dict/orders";
import { jobsDict } from "./dict/jobs";
import { reports } from "./dict/reports";
import { settingsDict } from "./dict/settings";
import { v2 } from "./dict/v2";
import { widgets } from "./dict/widgets";
import { wizard } from "./dict/wizard";
import { worklog } from "./dict/worklog";

export { LANGUAGES, LOCALES, detectLanguage } from "./core";
export type { Lang } from "./core";

const BUNDLE: Bundle = mergeBundles([
  common,
  dashboard,
  jobsDict,
  reports,
  settingsDict,
  wizard,
  assistant,
  v2,
  a11y,
  widgets,
  annual,
  goalsDict,
  ordersDict,
  docsDict,
  worklog,
  entry,
]);

export type Vars = Record<string, string | number>;

function interpolate(text: string, vars?: Vars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in vars ? String(vars[key]) : match,
  );
}

/** Übersetzt einen Schlüssel in die angegebene Sprache (Fallback: Deutsch). */
export function tl(lang: Lang, key: string, vars?: Vars): string {
  if (typeof vars?.["count"] === "number") {
    const suffix = vars["count"] === 1 ? "_one" : "_other";
    const plural = BUNDLE[lang]?.[key + suffix] ?? BUNDLE.de[key + suffix];
    if (plural) return interpolate(plural, vars);
  }
  return interpolate(BUNDLE[lang]?.[key] ?? BUNDLE.de[key] ?? key, vars);
}

export function currentLang(): Lang {
  return getData().settings.language;
}

/** Übersetzung außerhalb von React (Exporte, Benachrichtigungen). */
export function t(key: string, vars?: Vars): string {
  return tl(currentLang(), key, vars);
}

export function currentLocale(): string {
  return LOCALES[currentLang()];
}

export type TFunction = (key: string, vars?: Vars) => string;

/** React-Hook: übersetzt reaktiv zur eingestellten Sprache. */
export function useT(): { t: TFunction; lang: Lang; locale: string } {
  const lang = useAppData().settings.language;
  return {
    lang,
    locale: LOCALES[lang],
    t: (key, vars) => tl(lang, key, vars),
  };
}

export function languageLabel(lang: Lang): string {
  return LANGUAGES.find((l) => l.code === lang)?.native ?? lang;
}
