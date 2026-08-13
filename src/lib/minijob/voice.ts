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
      reject(new Error("Spracherkennung wird von diesem Browser nicht unterstützt."));
      return;
    }
    const rec = new Ctor();
    rec.lang = "de-DE";
    rec.interimResults = false;
    rec.continuous = false;
    let done = false;
    rec.onresult = (event) => {
      done = true;
      const first = event.results[0]?.[0]?.transcript ?? "";
      resolve(first.trim());
    };
    rec.onerror = () => {
      if (!done) reject(new Error("Sprachaufnahme fehlgeschlagen."));
    };
    rec.onend = () => {
      if (!done) reject(new Error("Keine Sprache erkannt."));
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

const NUM_WORDS: Record<string, number> = {
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
};

function toHour(token: string): number | null {
  const digit = Number(token.replace(",", "."));
  if (!Number.isNaN(digit)) return digit;
  const word = NUM_WORDS[token.toLowerCase()];
  return word === undefined ? null : word;
}

function times(text: string): { start: string; end: string } | null {
  const clock = text.match(/(\d{1,2})[:.](\d{2}).*?(?:bis|-|–).*?(\d{1,2})[:.](\d{2})/);
  if (clock) {
    return {
      start: `${clock[1]!.padStart(2, "0")}:${clock[2]}`,
      end: `${clock[3]!.padStart(2, "0")}:${clock[4]}`,
    };
  }
  const words = text.match(/(?:von\s+)?([\wäöü]+)\s*uhr?\s*(?:bis|-|–)\s*([\wäöü]+)/i);
  if (words) {
    const a = toHour(words[1]!);
    const b = toHour(words[2]!);
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
  const text = input.toLowerCase();
  if (/(arbeit|schicht).*(start|beginn)|start(e)? (die )?arbeit|einstempeln/.test(text))
    return { type: "start" };
  if (/(arbeit|schicht).*(ende|beend|stopp|stop)|feierabend|ausstempeln/.test(text))
    return { type: "stop" };
  if (/statistik|auswertung/.test(text)) return { type: "stats" };
  if (/verdienst|verdient|einnahmen|lohn/.test(text)) return { type: "earnings" };

  const t = times(text);
  if (t) {
    const pause = text.match(/(\d{1,3})\s*(?:minuten?\s*)?pause/);
    return {
      type: "shift",
      start: t.start,
      end: t.end,
      breakMinutes: pause ? Number(pause[1]) : 0,
    };
  }
  return { type: "unknown" };
}
