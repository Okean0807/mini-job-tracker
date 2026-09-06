import { t } from "@/lib/i18n";

import { formatDate, formatEuro, isoDate, shiftsInYear, timeFromDate } from "./calc";
import { payrollTotals } from "./payroll";
import { monthUsage, yearlyLimitOf } from "./limits";
import { payPeriods } from "./payday";
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

  if (
    n.startReminder &&
    clock >= n.startTime &&
    clock < addMinutes(n.startTime, 90) &&
    !data.timer
  ) {
    const hasToday = data.shifts.some((s) => s.date === today);
    if (!hasToday) {
      notifyOnce("start", today, t("notify.start.title"), t("notify.start.body"));
    }
  }

  if (n.endReminder && data.timer && clock >= n.endTime) {
    notifyOnce("end", today, t("notify.end.title"), t("notify.end.body"));
  }

  if (n.missingShift) {
    const yesterday = new Date(now.getTime() - 86_400_000);
    const day = yesterday.getDay();
    const iso = isoDate(yesterday);
    if (day !== 0 && day !== 6 && !data.shifts.some((s) => s.date === iso)) {
      notifyOnce(
        "missing",
        iso,
        t("notify.missing.title"),
        t("notify.missing.body", { date: formatDate(iso) }),
      );
    }
  }

  if (n.payday !== false) checkPayday(today);

  if (n.backupReminder) {
    const last = readFlags()["lastBackup"];
    const stale = !last || Date.now() - new Date(last).getTime() > 7 * 86_400_000;
    if (stale) {
      notifyOnce("backup", today.slice(0, 7), t("notify.backup.title"), t("notify.backup.body"));
    }
  }
}

/** Erinnerung am erwarteten Zahltag je Job. */
function checkPayday(today: string) {
  const { shifts, jobs, payments, settings } = getData();
  const resolve = makeResolver(jobs, settings);
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const periods = [
    ...payPeriods(jobs, shifts, payments, resolve, prev.getFullYear(), prev.getMonth()),
    ...payPeriods(jobs, shifts, payments, resolve, now.getFullYear(), now.getMonth()),
  ];
  for (const p of periods) {
    if (p.dueDate !== today || p.payment) continue;
    notifyOnce(
      `payday-${p.job.id}`,
      today,
      t("notify.payday.title"),
      t("notify.payday.body", { job: p.job.name, amount: formatEuro(p.expected) }),
    );
  }
}

function addMinutes(time: string, minutes: number): string {
  const [h = 0, m = 0] = time.split(":").map(Number);
  const total = Math.min(24 * 60 - 1, h * 60 + m + minutes);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export interface LimitStatus {
  monthShare: number;
  monthHoursShare: number;
  yearShare: number;
}

export function limitStatus(): LimitStatus {
  const { shifts, jobs, settings } = getData();
  const resolve = makeResolver(jobs, settings);
  const now = new Date();
  const month = monthUsage(shifts, resolve, settings, now.getFullYear(), now.getMonth());
  const yearEarnings = payrollTotals(
    shiftsInYear(shifts, now.getFullYear()),
    resolve,
    shifts,
  ).earnings;
  return {
    monthShare: month.earningsShare,
    monthHoursShare: month.hoursShare,
    yearShare:
      yearlyLimitOf(settings, now.getFullYear()) > 0
        ? (yearEarnings / yearlyLimitOf(settings, now.getFullYear())) * 100
        : 0,
  };
}

/** Minijob-Schwellen 75 / 90 / 100 Prozent – einmal pro Monat je Stufe. */
export function checkLimits() {
  const { monthShare, monthHoursShare } = limitStatus();
  const stamp = isoDate(new Date()).slice(0, 7);
  if (monthHoursShare >= 90) {
    notifyOnce(
      "limit-hours",
      stamp,
      t("notify.limitHours.title"),
      t("notify.limitHours.body", { percent: Math.round(monthHoursShare) }),
    );
  }
  if (monthShare >= 100) {
    notifyOnce("limit-100", stamp, t("notify.limit100.title"), t("notify.limit100.body"));
  } else if (monthShare >= 90) {
    notifyOnce("limit-90", stamp, t("notify.limit90.title"), t("notify.limit90.body"));
  } else if (monthShare >= 75) {
    notifyOnce("limit-75", stamp, t("notify.limit75.title"), t("notify.limit75.body"));
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
