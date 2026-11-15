import { t } from "@/lib/i18n";

import { formatDate, formatEuro, isoDate, shiftsInYear, timeFromDate } from "./calc";
import { payrollTotals } from "./payroll";
import { monthUsage, yearUsage } from "./limits";
import { limitAlertLevel } from "./limit-alert";
import { assessLegalIncome, evaluateRollingWarning, type LegalWarningStatus } from "./legal";
import { jobsApplyMinijobLimit } from "./work-mode";
import { payPeriods } from "./payday";
import { makeResolver } from "./resolve";
import { getData } from "./store";
import { isWithinTimeWindow, previousCalendarDate } from "./notify-time";

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
  if (!send(title, body)) return;
  flags[key] = stamp;
  writeFlags(flags);
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

export function send(title: string, body: string): boolean {
  if (!notificationsSupported() || Notification.permission !== "granted") return false;
  try {
    const registration = typeof navigator !== "undefined" && "serviceWorker" in navigator
      ? navigator.serviceWorker.controller
        ? navigator.serviceWorker.ready
        : null
      : null;
    if (registration) {
      void registration.then((reg) => reg.showNotification(title, { body, icon: "/icons/icon-192.png", tag: title })).catch(() => {});
      return true;
    }
    new Notification(title, { body, icon: "/icons/icon-192.png", tag: title });
    return true;
  } catch {
    return false;
  }
}

export function markBackup() {
  const flags = readFlags();
  flags["lastBackup"] = new Date().toISOString();
  writeFlags(flags);
}

export function getLastBackupAt(): number | null {
  const raw = readFlags()["lastBackup"];
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
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
    isWithinTimeWindow(clock, n.startTime, 90) &&
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
    const iso = previousCalendarDate(today);
    const [y = 0, m = 1, d = 1] = iso.split("-").map(Number);
    const day = new Date(y, m - 1, d).getDay();
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
    if (p.dueDate !== today || p.payments.length > 0) continue;
    notifyOnce(
      `payday-${p.job.id}`,
      today,
      t("notify.payday.title"),
      t("notify.payday.body", { job: p.job.name, amount: formatEuro(p.expected) }),
    );
  }
}


export interface LimitStatus {
  monthShare: number;
  monthHoursShare: number;
  yearShare: number;
  /** Status of the rolling legal forecast for the current month (same as the forecast card). */
  forecastStatus?: LegalWarningStatus;
}

export function limitStatus(): LimitStatus {
  const { shifts, jobs, settings } = getData();
  // Gleiche Regel wie Dashboard/LimitCard: ohne (bestätigten) Minijob –
  // z. B. nur Hauptbeschäftigung oder ungeklärter Altbestand – keine
  // Grenz-Benachrichtigungen.
  if (!jobsApplyMinijobLimit(jobs)) return { monthShare: 0, monthHoursShare: 0, yearShare: 0 };
  const resolve = makeResolver(jobs, settings);
  const now = new Date();
  const month = monthUsage(shifts, resolve, settings, now.getFullYear(), now.getMonth());
  const year = yearUsage(shifts, resolve, settings, now.getFullYear());
  const forecast = assessLegalIncome(getData(), `${isoDate(now).slice(0, 7)}-01`);
  return {
    monthShare: month.earningsShare,
    monthHoursShare: month.hoursShare,
    yearShare: year.earningsShare,
    forecastStatus: evaluateRollingWarning(forecast.rolling).status,
  };
}

/**
 * Minijob-Hinweise – einmal pro Monat je Stufe. Die Stufe kommt aus derselben
 * Entscheidung wie Dashboard und Heute-Karte (`limitAlertLevel`):
 * - "Minijob-Limit überschritten" nur bei tatsächlich überschrittener Jahresgrenze,
 * - Prognose-Hinweis, wenn die gleitende 12-Monats-Prognose eine Überschreitung zeigt,
 * - ein Monat über dem Monatsrichtwert ist ein Hinweis, keine Überschreitung,
 * - 75 / 90 Prozent des Monatsrichtwerts bleiben informative Schwellen.
 * Genau 100 % ist keine Überschreitung.
 */
export function checkLimits() {
  const { monthShare, monthHoursShare, yearShare, forecastStatus } = limitStatus();
  const level = limitAlertLevel(true, monthShare, yearShare, forecastStatus);
  const stamp = isoDate(new Date()).slice(0, 7);
  if (monthHoursShare >= 90) {
    notifyOnce(
      "limit-hours",
      stamp,
      t("notify.limitHours.title"),
      t("notify.limitHours.body", { percent: Math.round(monthHoursShare) }),
    );
  }
  if (level === "over") {
    notifyOnce("limit-100", stamp, t("notify.limit100.title"), t("notify.limit100.body"));
  } else if (level === "forecastOver") {
    notifyOnce(
      "limit-forecast",
      stamp,
      t("notify.limitForecast.title"),
      t("notify.limitForecast.body"),
    );
  } else if (level === "monthAbove") {
    notifyOnce(
      "limit-month-above",
      stamp,
      t("notify.limitMonthAbove.title"),
      t("notify.limitMonthAbove.body"),
    );
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
