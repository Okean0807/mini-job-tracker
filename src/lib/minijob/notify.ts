import { isoDate, shiftsInMonth, shiftsInYear, sumEarnings, timeFromDate } from "./calc";
import { makeResolver } from "./resolve";
import { getData } from "./store";

const FLAG_KEY = "minijob-notify-flags";

type Flags = Record<string, string>;

function readFlags(): Flags {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(FLAG_KEY) ?? "{}") as Flags;
  } catch {
    return {};
  }
}

function writeFlags(flags: Flags) {
  try {
    window.localStorage.setItem(FLAG_KEY, JSON.stringify(flags));
  } catch {
    /* ignorieren */
  }
}

/** Sendet eine Nachricht höchstens einmal pro Schlüssel und Tag/Periode. */
function notifyOnce(key: string, stamp: string, title: string, body: string) {
  const flags = readFlags();
  if (flags[key] === stamp) return;
  flags[key] = stamp;
  writeFlags(flags);
  send(title, body);
}

export function notificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function notificationPermission(): NotificationPermission | "unsupported" {
  return notificationsSupported() ? Notification.permission : "unsupported";
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (!notificationsSupported()) return false;
  const result = await Notification.requestPermission();
  return result === "granted";
}

export function send(title: string, body: string) {
  if (!notificationsSupported() || Notification.permission !== "granted") return;
  try {
    new Notification(title, { body, icon: "/icons/icon-192.png", tag: title });
  } catch {
    /* Browser blockiert */
  }
}

export function markBackup() {
  const flags = readFlags();
  flags["lastBackup"] = new Date().toISOString();
  writeFlags(flags);
}

/** Prüft alle Regeln (Limits, Erinnerungen) und sendet fällige Meldungen. */
export function runNotificationChecks() {
  const data = getData();
  const n = data.settings.notifications;
  if (!n.enabled || notificationPermission() !== "granted") return;

  const now = new Date();
  const today = isoDate(now);
  const clock = timeFromDate(now);

  if (n.limitAlerts) checkLimits();

  if (n.startReminder && clock >= n.startTime && clock < addMinutes(n.startTime, 90) && !data.timer) {
    const hasToday = data.shifts.some((s) => s.date === today);
    if (!hasToday) {
      notifyOnce("start", today, "Arbeitszeit starten", "Denk daran, deine Arbeitszeit zu starten.");
    }
  }

  if (n.endReminder && data.timer && clock >= n.endTime) {
    notifyOnce("end", today, "Arbeitszeit beenden", "Deine Zeiterfassung läuft noch. Jetzt beenden?");
  }

  if (n.missingShift) {
    const yesterday = new Date(now.getTime() - 86_400_000);
    const day = yesterday.getDay();
    const iso = isoDate(yesterday);
    if (day !== 0 && day !== 6 && !data.shifts.some((s) => s.date === iso)) {
      notifyOnce("missing", iso, "Eintrag fehlt", `Für den ${iso.split("-").reverse().join(".")} ist keine Schicht erfasst.`);
    }
  }

  if (n.backupReminder) {
    const last = readFlags()["lastBackup"];
    const stale = !last || Date.now() - new Date(last).getTime() > 7 * 86_400_000;
    if (stale) {
      notifyOnce("backup", today.slice(0, 7), "Backup erstellen", "Sichere deine Daten in der Cloud oder als Datei.");
    }
  }
}

function addMinutes(time: string, minutes: number): string {
  const [h = 0, m = 0] = time.split(":").map(Number);
  const total = Math.min(24 * 60 - 1, h * 60 + m + minutes);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export interface LimitStatus {
  monthShare: number;
  yearShare: number;
}

export function limitStatus(): LimitStatus {
  const { shifts, jobs, settings } = getData();
  const resolve = makeResolver(jobs, settings);
  const now = new Date();
  const monthEarnings = sumEarnings(shiftsInMonth(shifts, now.getFullYear(), now.getMonth()), resolve);
  const yearEarnings = sumEarnings(shiftsInYear(shifts, now.getFullYear()), resolve);
  return {
    monthShare: settings.monthlyLimit > 0 ? (monthEarnings / settings.monthlyLimit) * 100 : 0,
    yearShare: settings.yearlyLimit > 0 ? (yearEarnings / settings.yearlyLimit) * 100 : 0,
  };
}

/** Minijob-Schwellen 75 / 90 / 100 Prozent – einmal pro Monat je Stufe. */
export function checkLimits() {
  const { monthShare } = limitStatus();
  const stamp = new Date().toISOString().slice(0, 7);
  if (monthShare >= 100) {
    notifyOnce("limit-100", stamp, "Minijob-Limit überschritten", "Minijob-Limit überschritten.");
  } else if (monthShare >= 90) {
    notifyOnce("limit-90", stamp, "Minijob-Limit", "Sie nähern sich dem Minijob-Limit.");
  } else if (monthShare >= 75) {
    notifyOnce("limit-75", stamp, "Minijob-Limit", "Sie haben 75% Ihres Minijob-Limits erreicht.");
  }
}

let started = false;

export function initNotifications() {
  if (started || typeof window === "undefined") return;
  started = true;
  const tick = () => runNotificationChecks();
  setTimeout(tick, 4000);
  setInterval(tick, 5 * 60 * 1000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) tick();
  });
}
