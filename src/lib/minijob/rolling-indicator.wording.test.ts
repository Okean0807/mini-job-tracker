/**
 * AUD-09C – the rolling 12-month earnings indicator is an INFORMATIONAL orientation value.
 * Wording must never present it (or a calendar-year / month statistic) as a confirmed legal
 * Minijob assessment, a statutory forecast of regular earnings or a violation, in any of the
 * five languages, on any surface – including the notifications actually sent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { tl } from "@/lib/i18n";

import { isoDate } from "./calc";
import { checkLimits } from "./notify";
import { replaceAll } from "./store";
import { DEFAULT_SETTINGS, type Shift } from "./types";

const LANGS = ["de", "en", "ru", "tr", "pl"] as const;
type Lang = (typeof LANGS)[number];

/** Words that would turn an orientation value into a legal conclusion. */
const VIOLATION: Record<Lang, RegExp> = {
  de: /Verstoß|rechtlich überschritten|Minijob-Limit überschritten|Überschreitung festgestellt|überschreitet die (reguläre )?Grenze|Prognose überschreitet/i,
  en: /violation|illegal|legally exceeded|limit exceeded|forecast exceeds/i,
  ru: /нарушени|незаконн|юридически превышен|превышен(о|а)? лимит/i,
  tr: /ihlal|yasa dışı|hukuken aşıl|sınır aşıldı|tahmin aşıyor/i,
  pl: /naruszeni|niezgodn|prawnie przekroczon|limit został przekroczony|prognoza przekracza/i,
};
/** The orientation vocabulary each language must carry. */
const ORIENTATION: Record<Lang, RegExp> = {
  de: /Orientierung|Orientierungsrahmen/,
  en: /orientation|reference range/i,
  ru: /ориентир/i,
  tr: /yönlendirme/i,
  pl: /orientacyj/i,
};
const NOT_LEGAL: Record<Lang, RegExp> = {
  de: /keine rechtliche Feststellung/,
  en: /not a legal determination/i,
  ru: /не юридическое заключение/i,
  tr: /hukuki bir tespit değildir/i,
  pl: /nie jest ustalenie prawne/i,
};

const ROLLING_KEYS = [
  "rolling.title",
  "rolling.subtitle",
  "rolling.actual",
  "rolling.planned",
  "rolling.total",
  "rolling.frame",
  "rolling.statusLabel",
  "rolling.statusAbove",
  "rolling.statusWithin",
  "rolling.statusNear",
  "rolling.aboveHint",
  "rolling.disclaimer",
  "rolling.windowNote",
  "rolling.plannedNote",
  "rolling.signal",
  "notify.limitRolling.title",
  "notify.limitRolling.body",
  "widget.legalForecast",
] as const;

describe("every language carries the rolling-indicator terminology", () => {
  it("all keys exist in de, en, ru, tr and pl", () => {
    for (const lang of LANGS) {
      for (const key of ROLLING_KEYS) {
        const text = tl(lang, key);
        expect(text, `${lang} ${key}`).not.toBe(key);
        expect(text.length, `${lang} ${key}`).toBeGreaterThan(3);
      }
    }
  });

  it("the retired 'forecast' / 'exceeded' keys are gone", () => {
    for (const key of [
      "legalForecast.title",
      "legalForecast.statusMaximum",
      "legalForecast.statusRegularExceeded",
      "legalForecast.maximum",
      "legalForecast.specialMonths",
      "dash.limitYearOver",
      "dash.limitMonthOver",
      "notify.limit100.title",
      "notify.limitForecast.title",
    ]) {
      for (const lang of LANGS) expect(tl(lang, key), `${lang} ${key}`).toBe(key);
    }
  });

  it("no rolling-indicator text uses violation or legal-conclusion wording, in any language", () => {
    for (const lang of LANGS) {
      for (const key of ROLLING_KEYS) {
        expect(tl(lang, key), `${lang} ${key}`).not.toMatch(VIOLATION[lang]);
      }
      for (const key of [
        "dash.limitYearAbove",
        "dash.limitMonthAbove",
        "limit.yearAboveNote",
        "limit.monthAboveNote",
      ]) {
        expect(tl(lang, key), `${lang} ${key}`).not.toMatch(VIOLATION[lang]);
      }
    }
  });

  it("the card's status and disclaimer identify an orientation value and deny any legal finding", () => {
    for (const lang of LANGS) {
      expect(tl(lang, "rolling.disclaimer"), lang).toMatch(ORIENTATION[lang]);
      expect(tl(lang, "rolling.subtitle"), lang).toMatch(ORIENTATION[lang]);
      expect(tl(lang, "rolling.statusAbove"), lang).toMatch(ORIENTATION[lang]);
      expect(tl(lang, "rolling.statusWithin"), lang).toMatch(ORIENTATION[lang]);
      expect(tl(lang, "rolling.aboveHint"), lang).toMatch(NOT_LEGAL[lang]);
    }
  });

  it("the suggested German terminology is used verbatim", () => {
    expect(tl("de", "rolling.title")).toBe("Verdienste der letzten 12 Monate");
    expect(tl("de", "rolling.statusAbove")).toBe(
      "Erfasste Verdienste über dem Orientierungsrahmen",
    );
    expect(tl("de", "rolling.statusWithin")).toBe(
      "Erfasste Verdienste innerhalb des Orientierungsrahmens",
    );
    expect(tl("de", "rolling.disclaimer")).toMatch(
      /^Dieser Wert dient nur zur Orientierung\. Er ersetzt nicht die vorausschauende Beurteilung des regelmäßigen Arbeitsentgelts im Beschäftigungszeitraum\./,
    );
  });

  it("the extreme-month signal is labelled as informational and not the statutory exception", () => {
    expect(tl("de", "rolling.signal")).toMatch(/Hinweis \(Orientierung\)/);
    expect(tl("de", "rolling.signal")).toMatch(
      /entscheidet nicht darüber, ob die gesetzliche Ausnahme/,
    );
    expect(tl("en", "rolling.signal")).toMatch(/does not decide whether the statutory exception/i);
    expect(tl("ru", "rolling.signal")).toMatch(
      /не определяет, применяется ли законное исключение/i,
    );
    expect(tl("tr", "rolling.signal")).toMatch(
      /yasal istisnanın geçerli olup olmadığına karar vermez/i,
    );
    expect(tl("pl", "rolling.signal")).toMatch(
      /nie rozstrzyga, czy zastosowanie ma ustawowy wyjątek/i,
    );
    for (const lang of LANGS) expect(tl(lang, "rolling.signal"), lang).toMatch(ORIENTATION[lang]);
  });
});

describe("notifications never describe an informational result as a confirmed legal violation", () => {
  const sent: Array<{ title: string; body: string }> = [];
  beforeEach(() => {
    sent.length = 0;
    window.localStorage.clear();
    class FakeNotification {
      static permission: NotificationPermission = "granted";
      constructor(title: string, options?: NotificationOptions) {
        sent.push({ title, body: options?.body ?? "" });
      }
    }
    vi.stubGlobal("Notification", FakeNotification);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 5, 15, 10, 0));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  let n = 0;
  const entry = (date: string, amount: number): Shift =>
    ({
      id: `w${n++}`,
      date,
      start: "08:00",
      end: "09:00",
      breakMinutes: 0,
      kind: "arbeit",
      rate: amount,
    }) as Shift;
  const seed = (lang: Lang, shifts: Shift[]) =>
    replaceAll({
      shifts,
      jobs: [],
      settings: { ...DEFAULT_SETTINGS, limitAuto: true, language: lang },
    });

  const scenarios: Record<string, Shift[]> = {
    "rolling indicator above its range (6 x 1,300 EUR)": [1, 2, 3, 4, 5, 6].map((m) =>
      entry(`2026-0${m}-10`, 1300),
    ),
    "a single high month (1,000 EUR)": [entry("2026-06-10", 1000)],
    "exactly the monthly limit (603 EUR)": [entry("2026-06-10", 603)],
  };

  it.each(Object.entries(scenarios))(
    "%s: in every language no notification reads as a violation",
    (_name, shifts) => {
      for (const lang of LANGS) {
        sent.length = 0;
        window.localStorage.clear();
        seed(lang, shifts);
        checkLimits();
        expect(sent.length, `${lang}: something is sent`).toBeGreaterThan(0);
        for (const { title, body } of sent) {
          expect(`${title} ${body}`, `${lang}`).not.toMatch(VIOLATION[lang]);
        }
      }
    },
  );

  it("the rolling-indicator notification says 'orientation' and 'not a legal determination' in every language", () => {
    for (const lang of LANGS) {
      sent.length = 0;
      window.localStorage.clear();
      seed(lang, scenarios["rolling indicator above its range (6 x 1,300 EUR)"]!);
      checkLimits();
      const all = sent.map((s) => `${s.title} ${s.body}`).join(" | ");
      expect(all, lang).toContain(tl(lang, "notify.limitRolling.title"));
      expect(all, lang).toContain(tl(lang, "notify.limitRolling.body"));
      expect(tl(lang, "notify.limitRolling.body"), lang).toMatch(NOT_LEGAL[lang]);
    }
    expect(tl("de", "notify.limitRolling.title")).toBe("Verdienste der letzten 12 Monate");
  });

  it("a calendar-year or monthly statistic alone never triggers the rolling notification", () => {
    seed("de", [entry("2026-06-10", 1000)]);
    checkLimits();
    expect(sent.map((s) => s.title)).not.toContain(tl("de", "notify.limitRolling.title"));
    expect(
      sent.some(
        (s) => isoDate(new Date()).length > 0 && s.body === tl("de", "notify.limitRolling.body"),
      ),
    ).toBe(false);
  });
});
