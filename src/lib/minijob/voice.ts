import { currentLang, currentLocale, tl } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n/core";

export type VoiceResult = { transcript: string };

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onend: (() => void) | null;
}

export function voiceSupported(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as Record<string, unknown>;
  return Boolean(w["SpeechRecognition"] || w["webkitSpeechRecognition"]);
}

export function listenOnce(): Promise<string> {
  return new Promise((resolve, reject) => {
    const w = window as unknown as Record<string, unknown>;
    const Ctor = (w["SpeechRecognition"] || w["webkitSpeechRecognition"]) as
      | (new () => SpeechRecognitionLike)
      | undefined;
    if (!Ctor) {
      reject(new Error(tl(currentLang(), "voice.error.unsupported")));
      return;
    }
    const rec = new Ctor();
    rec.lang = currentLocale();
    rec.interimResults = false;
    rec.continuous = false;
    let done = false;
    rec.onresult = (event) => {
      done = true;
      const first = event.results[0]?.[0]?.transcript ?? "";
      resolve(first.trim());
    };
    rec.onerror = () => {
      if (!done) reject(new Error(tl(currentLang(), "voice.error.recording")));
    };
    rec.onend = () => {
      if (!done) reject(new Error(tl(currentLang(), "voice.error.noSpeech")));
    };
    rec.start();
  });
}

export type VoiceCommand =
  | { type: "start" }
  | { type: "stop" }
  | { type: "stats" }
  | { type: "earnings" }
  | { type: "shift"; start: string; end: string; breakMinutes: number }
  | { type: "unknown" };

const NUM_WORDS: Record<Lang, Record<string, number>> = {
  de: {
    null: 0,
    eins: 1,
    ein: 1,
    zwei: 2,
    drei: 3,
    vier: 4,
    fünf: 5,
    sechs: 6,
    sieben: 7,
    acht: 8,
    neun: 9,
    zehn: 10,
    elf: 11,
    zwölf: 12,
    dreizehn: 13,
    vierzehn: 14,
    fünfzehn: 15,
    sechzehn: 16,
    siebzehn: 17,
    achtzehn: 18,
    neunzehn: 19,
    zwanzig: 20,
    einundzwanzig: 21,
    zweiundzwanzig: 22,
    dreiundzwanzig: 23,
  },
  en: {
    zero: 0,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
    thirteen: 13,
    fourteen: 14,
    fifteen: 15,
    sixteen: 16,
    seventeen: 17,
    eighteen: 18,
    nineteen: 19,
    twenty: 20,
  },
  ru: {
    ноль: 0,
    один: 1,
    два: 2,
    три: 3,
    четыре: 4,
    пять: 5,
    шесть: 6,
    семь: 7,
    восемь: 8,
    девять: 9,
    десять: 10,
    одиннадцать: 11,
    двенадцать: 12,
    тринадцать: 13,
    четырнадцать: 14,
    пятнадцать: 15,
    шестнадцать: 16,
    семнадцать: 17,
    восемнадцать: 18,
    девятнадцать: 19,
    двадцать: 20,
  },
  tr: {
    sıfır: 0,
    bir: 1,
    iki: 2,
    üç: 3,
    dört: 4,
    beş: 5,
    altı: 6,
    yedi: 7,
    sekiz: 8,
    dokuz: 9,
    on: 10,
    onbir: 11,
    oniki: 12,
    onüç: 13,
    ondört: 14,
    onbeş: 15,
    onaltı: 16,
    onyedi: 17,
    onsekiz: 18,
    ondokuz: 19,
    yirmi: 20,
  },
  pl: {
    zero: 0,
    jeden: 1,
    dwa: 2,
    trzy: 3,
    cztery: 4,
    pięć: 5,
    sześć: 6,
    siedem: 7,
    osiem: 8,
    dziewięć: 9,
    dziesięć: 10,
    jedenaście: 11,
    dwanaście: 12,
    trzynaście: 13,
    czternaście: 14,
    piętnaście: 15,
    szesnaście: 16,
    siedemnaście: 17,
    osiemnaście: 18,
    dziewiętnaście: 19,
    dwadzieścia: 20,
  },
};

function toHour(token: string, lang: Lang): number | null {
  const digit = Number(token.replace(",", "."));
  if (!Number.isNaN(digit)) return digit;
  const word = NUM_WORDS[lang][token.toLowerCase()];
  return word === undefined ? null : word;
}

// Schlüsselwörter zur Erkennung von Sprachbefehlen je Sprache.
const KEYWORDS: Record<Lang, { start: RegExp; stop: RegExp; stats: RegExp; earnings: RegExp; clockJoin: RegExp; wordJoin: RegExp; pause: RegExp; hourWord: RegExp }> = {
  de: {
    start: /(arbeit|schicht).*(start|beginn)|start(e)? (die )?arbeit|einstempeln/,
    stop: /(arbeit|schicht).*(ende|beend|stopp|stop)|feierabend|ausstempeln/,
    stats: /statistik|auswertung/,
    earnings: /verdienst|verdient|einnahmen|lohn/,
    clockJoin: /bis|-|–/,
    wordJoin: /(?:von\s+)?([\wäöü]+)\s*uhr?\s*(?:bis|-|–)\s*([\wäöü]+)/i,
    pause: /(\d{1,3})\s*(?:minuten?\s*)?pause/,
    hourWord: /uhr?/,
  },
  en: {
    start: /(work|shift).*(start|begin)|start (the )?work|clock in/,
    stop: /(work|shift).*(end|stop|finish)|clock out/,
    stats: /statistics|stats|overview/,
    earnings: /earnings|earned|income|wage/,
    clockJoin: /to|-|–/,
    wordJoin: /(?:from\s+)?(\w+)\s*(?:o'?clock)?\s*(?:to|-|–)\s*(\w+)/i,
    pause: /(\d{1,3})\s*(?:minutes?\s*)?break/,
    hourWord: /o'?clock/,
  },
  ru: {
    start: /(работ|смен).*(начал|старт)|начать работу|отметиться/,
    stop: /(работ|смен).*(конец|заверш|стоп)|закончить работу|отметить уход/,
    stats: /статистик|обзор/,
    earnings: /заработ|доход|зарплат/,
    clockJoin: /до|-|–/,
    wordJoin: /(?:с\s+)?(\w+)\s*(?:час(?:ов)?)?\s*(?:до|-|–)\s*(\w+)/i,
    pause: /(\d{1,3})\s*(?:минут\s*)?перерыв/,
    hourWord: /час(?:ов)?/,
  },
  tr: {
    start: /(iş|vardiya).*(başla)|işe başla|giriş yap/,
    stop: /(iş|vardiya).*(bit|dur)|işten çık|çıkış yap/,
    stats: /istatistik|özet/,
    earnings: /kazanç|kazandım|gelir|maaş/,
    clockJoin: /kadar|-|–/,
    wordJoin: /(?:saat\s+)?(\w+)\s*(?:'?den|'?dan)?\s*(?:-|–|kadar)\s*(\w+)/i,
    pause: /(\d{1,3})\s*(?:dakika\s*)?mola/,
    hourWord: /saat/,
  },
  pl: {
    start: /(praca|zmiana).*(start|początek)|zacznij pracę|rozpocznij pracę/,
    stop: /(praca|zmiana).*(koniec|zakończ|stop)|zakończ pracę/,
    stats: /statystyk|podsumowanie/,
    earnings: /zarobek|zarobiłem|dochód|pensj/,
    clockJoin: /do|-|–/,
    wordJoin: /(?:od\s+)?(\w+)\s*(?:godzin[ay]?)?\s*(?:do|-|–)\s*(\w+)/i,
    pause: /(\d{1,3})\s*(?:minut\s*)?przerw/,
    hourWord: /godzin[ay]?/,
  },
};

function times(text: string, lang: Lang): { start: string; end: string } | null {
  const kw = KEYWORDS[lang];
  const clock = text.match(/(\d{1,2})[:.](\d{2}).*?(?:bis|to|do|kadar|до|-|–).*?(\d{1,2})[:.](\d{2})/);
  if (clock) {
    return {
      start: `${clock[1]!.padStart(2, "0")}:${clock[2]}`,
      end: `${clock[3]!.padStart(2, "0")}:${clock[4]}`,
    };
  }
  const words = text.match(kw.wordJoin);
  if (words) {
    const a = toHour(words[1]!, lang);
    const b = toHour(words[2]!, lang);
    if (a !== null && b !== null) {
      return {
        start: `${String(a).padStart(2, "0")}:00`,
        end: `${String(b).padStart(2, "0")}:00`,
      };
    }
  }
  return null;
}

export function parseVoice(input: string): VoiceCommand {
  const lang = currentLang();
  const text = input.toLowerCase();
  const kw = KEYWORDS[lang];
  if (kw.start.test(text)) return { type: "start" };
  if (kw.stop.test(text)) return { type: "stop" };
  if (kw.stats.test(text)) return { type: "stats" };
  if (kw.earnings.test(text)) return { type: "earnings" };

  const t = times(text, lang);
  if (t) {
    const pause = text.match(kw.pause);
    return {
      type: "shift",
      start: t.start,
      end: t.end,
      breakMinutes: pause ? Number(pause[1]) : 0,
    };
  }
  return { type: "unknown" };
}
