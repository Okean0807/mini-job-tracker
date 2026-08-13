export type Lang = "de" | "en" | "ru" | "tr" | "pl";

export const LANGUAGES: { code: Lang; label: string; native: string }[] = [
  { code: "de", label: "Deutsch", native: "Deutsch" },
  { code: "en", label: "English", native: "English" },
  { code: "ru", label: "Русский", native: "Русский" },
  { code: "tr", label: "Türkçe", native: "Türkçe" },
  { code: "pl", label: "Polski", native: "Polski" },
];

export const LOCALES: Record<Lang, string> = {
  de: "de-DE",
  en: "en-GB",
  ru: "ru-RU",
  tr: "tr-TR",
  pl: "pl-PL",
};

export type Dict = Record<string, string>;
export type Bundle = Record<Lang, Dict>;

/** Browser-Sprache auf eine unterstützte Sprache abbilden. */
export function detectLanguage(): Lang {
  if (typeof navigator === "undefined") return "de";
  const candidates = [navigator.language, ...(navigator.languages ?? [])];
  for (const raw of candidates) {
    const code = raw?.slice(0, 2).toLowerCase();
    const hit = LANGUAGES.find((l) => l.code === code);
    if (hit) return hit.code;
  }
  return "en";
}

export function mergeBundles(bundles: Bundle[]): Bundle {
  const out = {} as Bundle;
  for (const lang of LANGUAGES.map((l) => l.code)) {
    out[lang] = Object.assign({}, ...bundles.map((b) => b[lang] ?? {})) as Dict;
  }
  return out;
}
