import { isoDate } from "./calc";

/** Gauss / Anonymous Gregorian algorithm – Ostersonntag */
function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/** Buß- und Bettag: Mittwoch vor dem 23. November */
function bussUndBettag(year: number): Date {
  const d = new Date(year, 10, 22);
  while (d.getDay() !== 3) d.setDate(d.getDate() - 1);
  return d;
}

const ALL = "ALL";

export interface Holiday {
  date: string;
  name: string;
}

/**
 * Gesetzliche Feiertage in Deutschland für ein Jahr und ein Bundesland.
 */
export function holidaysFor(year: number, state: string): Holiday[] {
  const easter = easterSunday(year);
  const entries: { date: Date; name: string; states: string[] }[] = [
    { date: new Date(year, 0, 1), name: "Neujahr", states: [ALL] },
    { date: new Date(year, 0, 6), name: "Heilige Drei Könige", states: ["BW", "BY", "ST"] },
    { date: new Date(year, 2, 8), name: "Internationaler Frauentag", states: ["BE", "MV"] },
    { date: addDays(easter, -2), name: "Karfreitag", states: [ALL] },
    { date: addDays(easter, 1), name: "Ostermontag", states: [ALL] },
    { date: new Date(year, 4, 1), name: "Tag der Arbeit", states: [ALL] },
    { date: addDays(easter, 39), name: "Christi Himmelfahrt", states: [ALL] },
    { date: addDays(easter, 50), name: "Pfingstmontag", states: [ALL] },
    {
      date: addDays(easter, 60),
      name: "Fronleichnam",
      states: ["BW", "BY", "HE", "NW", "RP", "SL"],
    },
    { date: new Date(year, 7, 8), name: "Friedensfest", states: [] },
    { date: new Date(year, 7, 15), name: "Mariä Himmelfahrt", states: ["SL"] },
    { date: new Date(year, 8, 20), name: "Weltkindertag", states: ["TH"] },
    { date: new Date(year, 9, 3), name: "Tag der Deutschen Einheit", states: [ALL] },
    {
      date: new Date(year, 9, 31),
      name: "Reformationstag",
      states: ["BB", "HB", "HH", "MV", "NI", "SN", "ST", "SH", "TH"],
    },
    { date: new Date(year, 10, 1), name: "Allerheiligen", states: ["BW", "BY", "NW", "RP", "SL"] },
    { date: bussUndBettag(year), name: "Buß- und Bettag", states: ["SN"] },
    { date: new Date(year, 11, 25), name: "1. Weihnachtstag", states: [ALL] },
    { date: new Date(year, 11, 26), name: "2. Weihnachtstag", states: [ALL] },
  ];

  return entries
    .filter((e) => e.states.includes(ALL) || e.states.includes(state))
    .map((e) => ({ date: isoDate(e.date), name: e.name }))
    .sort((a, b) => (a.date > b.date ? 1 : -1));
}

const cache = new Map<string, Map<string, string>>();

export function holidayMap(year: number, state: string): Map<string, string> {
  const key = `${year}-${state}`;
  let map = cache.get(key);
  if (!map) {
    map = new Map(holidaysFor(year, state).map((h) => [h.date, h.name]));
    cache.set(key, map);
  }
  return map;
}

export function holidayName(date: string, state: string): string | undefined {
  const year = Number(date.slice(0, 4));
  return holidayMap(year, state).get(date);
}

export function isHoliday(date: string, state: string): boolean {
  return holidayName(date, state) !== undefined;
}
