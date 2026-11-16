/**
 * AUD-09D – notification consistency for the limit hints.
 *
 * 1. highVariation is a dashboard-only informational signal: it is deliberately NOT a
 *    notification (it is tied to a month anywhere in the rolling 12 months, so a notification
 *    would repeat every month for up to a year; the month-above hint already covers the current
 *    month, and nothing is ever sent for the signal itself).
 * 2. Flag storage: `minijob-notify-flags` is one flat map read and written by exact key. The
 *    retired `limit-100` key has no reader any more; it is deliberately left in place and
 *    ignored (no migration): it cannot suppress or duplicate anything, and unrelated keys are
 *    preserved because every write is read-merge-write.
 * 3. Eligibility: the limit notifications use the same gate as the dashboard
 *    (`jobsApplyMinijobLimit`), plus the user's own notification settings.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { tl } from "@/lib/i18n";

import { assessLegalIncome, evaluateRollingWarning } from "./legal";
import { hasMonthAboveDoubleReference } from "./legal/warnings";
import { limitAlertLevel } from "./limit-alert";
import { monthUsage, yearUsage } from "./limits";
import { checkLimits, limitStatus, runNotificationChecks } from "./notify";
import { makeResolver } from "./resolve";
import { getData, replaceAll } from "./store";
import {
  DEFAULT_NOTIFICATIONS,
  DEFAULT_SETTINGS,
  type Job,
  type NotificationSettings,
  type Shift,
} from "./types";
import { jobsApplyMinijobLimit } from "./work-mode";

const FLAG_KEY = "minijob-notify-flags";
const sent: Array<{ title: string; body: string }> = [];
let permission: NotificationPermission = "granted";

beforeEach(() => {
  sent.length = 0;
  permission = "granted";
  window.localStorage.clear();
  class FakeNotification {
    static get permission(): NotificationPermission {
      return permission;
    }
    constructor(title: string, options?: NotificationOptions) {
      sent.push({ title, body: options?.body ?? "" });
    }
  }
  vi.stubGlobal("Notification", FakeNotification);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 5, 15, 10, 0)); // 15 June 2026
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

let n = 0;
const entry = (date: string, amount: number, jobId?: string): Shift =>
  ({
    id: `f${n++}`,
    date,
    start: "08:00",
    end: "09:00",
    breakMinutes: 0,
    kind: "arbeit",
    rate: amount, // one hour: earnings == amount
    ...(jobId ? { jobId } : {}),
  }) as Shift;
const job = (id: string, over: Partial<Job> = {}): Job => ({
  id,
  name: id,
  color: "#000",
  mode: "flex",
  employmentType: "minijob",
  ...over,
});
/** Job data from before employmentType existed: the field is absent. */
const legacyJob = (id: string, mode: Job["mode"]): Job => ({ id, name: id, color: "#000", mode });
const seed = (
  shifts: Shift[],
  jobs: Job[] = [],
  notifications: Partial<NotificationSettings> = {},
) =>
  replaceAll({
    shifts,
    jobs,
    settings: {
      ...DEFAULT_SETTINGS,
      limitAuto: true,
      notifications: { ...DEFAULT_NOTIFICATIONS, ...notifications },
    },
  });
const flags = () =>
  JSON.parse(window.localStorage.getItem(FLAG_KEY) ?? "{}") as Record<string, string>;
const limitFlags = () =>
  Object.keys(flags())
    .filter((k) => k.startsWith("limit-"))
    .sort();
const MONTH = "2026-06";

/** The level the dashboard decides for the current month (same inputs as routes/index.tsx). */
function dashboardLevel() {
  const { shifts, jobs, settings } = getData();
  const resolve = makeResolver(jobs, settings);
  const mu = monthUsage(shifts, resolve, settings, 2026, 5);
  const yu = yearUsage(shifts, resolve, settings, 2026);
  const rolling = assessLegalIncome(getData(), "2026-06-01").rolling;
  return limitAlertLevel(
    jobsApplyMinijobLimit(jobs),
    mu.share,
    yu.share,
    evaluateRollingWarning(rolling).status,
    hasMonthAboveDoubleReference(rolling),
  );
}

describe("1. highVariation: a dashboard signal, deliberately not a notification", () => {
  it("an extreme EARLIER month: the dashboard shows the signal, nothing is sent", () => {
    seed([entry("2026-02-03", 6000), entry("2026-06-10", 100)]);
    expect(dashboardLevel()).toBe("highVariation");
    checkLimits();
    expect(sent).toEqual([]);
    expect(limitFlags()).toEqual([]);
  });

  it("the extreme month IS the current month: exactly one notification, the month hint, not the signal", () => {
    seed([entry("2026-06-10", 1400)]); // above twice the monthly reference (1,206)
    expect(dashboardLevel()).toBe("highVariation");
    checkLimits();
    checkLimits(); // the next 5-minute tick
    expect(sent).toHaveLength(1);
    expect(limitFlags()).toEqual(["limit-month-above"]);
    expect(sent[0]!.body).toBe(tl("de", "notify.limitMonthAbove.body"));
    expect(sent[0]!.body).not.toBe(tl("de", "rolling.signal"));
    expect(sent[0]!.body).not.toMatch(/unvorhersehbar|Ausnahme/);
  });

  it("the status the notifications use carries no highVariation, and no notification text exists for it", () => {
    seed([entry("2026-02-03", 6000)]);
    expect(limitStatus()).not.toHaveProperty("highVariation");
    for (const lang of ["de", "en", "ru", "tr", "pl"] as const) {
      for (const key of [
        "notify.limitHighVariation.title",
        "notify.limitVariation.title",
        "notify.limitSignal.title",
      ]) {
        expect(tl(lang, key)).toBe(key);
      }
    }
  });
});

describe("2. notification flags: the retired limit-100 key and unrelated keys", () => {
  const unrelated = {
    start: "2026-06-15",
    backup: "2026-06",
    lastBackup: "2026-05-30T08:00:00.000Z",
    "limit-hours": "2026-05",
  };

  it("an old limit-100 flag is left untouched and ignored; unrelated flags are preserved", () => {
    window.localStorage.setItem(FLAG_KEY, JSON.stringify({ ...unrelated, "limit-100": MONTH }));
    seed([entry("2026-06-10", 1000)]);
    checkLimits();
    const after = flags();
    expect(after["limit-100"]).toBe(MONTH); // not migrated, not removed, not rewritten
    for (const [key, value] of Object.entries(unrelated)) expect(after[key], key).toBe(value);
    expect(after["limit-month-above"]).toBe(MONTH);
  });

  it("the new month hint is sent once in the upgrade month even though the old flag is set (it corrects the old alarm)", () => {
    window.localStorage.setItem(FLAG_KEY, JSON.stringify({ "limit-100": MONTH }));
    seed([entry("2026-06-10", 1000)]);
    checkLimits();
    checkLimits();
    checkLimits();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.title).toBe(tl("de", "notify.limitMonthAbove.title"));
  });

  it("the rolling indicator notification is also sent once with an old flag present", () => {
    window.localStorage.setItem(FLAG_KEY, JSON.stringify({ "limit-100": MONTH }));
    seed([1, 2, 3, 4, 5, 6].map((m) => entry(`2026-0${m}-10`, 1400)));
    checkLimits();
    checkLimits();
    expect(sent).toHaveLength(1);
    expect(limitFlags().sort()).toEqual(["limit-100", "limit-rolling"]);
  });

  it("no code path writes limit-100 any more", () => {
    seed([1, 2, 3, 4, 5, 6].map((m) => entry(`2026-0${m}-10`, 1400)));
    checkLimits();
    expect(flags()["limit-100"]).toBeUndefined();
  });

  it("the new keys never collide with the old ones and each fires at most once per month", () => {
    seed([entry("2026-06-10", 480)]); // 80 % of 603
    checkLimits();
    expect(limitFlags()).toEqual(["limit-75"]);
    seed([entry("2026-06-10", 560)]); // 93 %
    checkLimits();
    seed([entry("2026-06-10", 1000)]); // above the reference
    checkLimits();
    checkLimits();
    expect(limitFlags()).toEqual(["limit-75", "limit-90", "limit-month-above"]);
    expect(sent).toHaveLength(3); // one per tier, none repeated
  });

  it("two different findings in one month are two different notifications, each sent once (never a duplicate of one finding)", () => {
    seed([entry("2026-06-10", 1000)]); // month hint
    checkLimits();
    seed([1, 2, 3, 4, 5, 6].map((m) => entry(`2026-0${m}-10`, 1400))); // now the rolling indicator is above its range
    checkLimits();
    checkLimits();
    expect(limitFlags()).toEqual(["limit-month-above", "limit-rolling"]);
    expect(sent.map((s) => s.title)).toEqual([
      tl("de", "notify.limitMonthAbove.title"),
      tl("de", "notify.limitRolling.title"),
    ]);
  });

  it("a new month sends again (the stamp is the month)", () => {
    seed([entry("2026-06-10", 1000)]);
    checkLimits();
    vi.setSystemTime(new Date(2026, 6, 2, 10, 0)); // 2 July
    seed([entry("2026-07-01", 1000)]);
    checkLimits();
    expect(sent).toHaveLength(2);
    expect(flags()["limit-month-above"]).toBe("2026-07");
  });
});

describe("3. eligibility: who can receive the limit notifications", () => {
  const sixMonths = (jobId?: string) =>
    [1, 2, 3, 4, 5, 6].map((m) => entry(`2026-0${m}-10`, 1400, jobId));
  const oneMonth = (jobId?: string) => [entry("2026-06-10", 1000, jobId)];

  const configs: Array<{
    name: string;
    jobs: Job[];
    jobId?: string;
    fires: boolean;
  }> = [
    { name: "no jobs yet (onboarding default)", jobs: [], fires: true },
    { name: "confirmed Minijob", jobs: [job("a")], jobId: "a", fires: true },
    {
      name: "legacy flex job without employmentType (Minijob fallback)",
      jobs: [legacyJob("a", "flex")],
      jobId: "a",
      fires: true,
    },
    {
      name: "main employment only",
      jobs: [job("a", { employmentType: "hauptbeschaeftigung" })],
      jobId: "a",
      fires: false,
    },
    {
      name: "self-employment only",
      jobs: [job("a", { employmentType: "selbststaendig" })],
      jobId: "a",
      fires: false,
    },
    {
      name: "legacy self-employed mode without employmentType",
      jobs: [legacyJob("a", "selbststaendig")],
      jobId: "a",
      fires: false,
    },
    {
      name: "short-term employment only",
      jobs: [job("a", { employmentType: "kurzfristig" })],
      jobId: "a",
      fires: false,
    },
    {
      name: "unconfirmed legacy fest job",
      jobs: [legacyJob("a", "fest")],
      jobId: "a",
      fires: false,
    },
    {
      name: "archived Minijob next to an active main employment",
      jobs: [job("a", { archived: true }), job("m", { employmentType: "hauptbeschaeftigung" })],
      jobId: "a",
      fires: false,
    },
    {
      name: "archived Minijob next to an active Minijob (shifts on the active one)",
      jobs: [job("a", { archived: true }), job("b")],
      jobId: "b",
      fires: true,
    },
  ];

  it.each(configs)("$name", ({ jobs, jobId, fires }) => {
    // Entries assigned to a non-Minijob job are already left out of the earnings; entries
    // without a job count as Minijob-eligible, so only they depend on the gate itself.
    for (const shifts of [sixMonths(jobId), oneMonth(jobId), sixMonths(undefined)]) {
      sent.length = 0;
      window.localStorage.clear();
      seed(shifts, jobs);
      checkLimits();
      expect(limitFlags().length > 0, JSON.stringify(limitFlags())).toBe(fires);
      expect(sent.length > 0).toBe(fires);
    }
  });

  it("mixed employment types: only the Minijob's earnings count, a high main employment sends nothing", () => {
    const jobs = [job("a"), job("m", { employmentType: "hauptbeschaeftigung" })];
    seed(
      [1, 2, 3, 4, 5, 6].flatMap((m) => [
        entry(`2026-0${m}-10`, 5000, "m"),
        entry(`2026-0${m}-11`, 100, "a"),
      ]),
      jobs,
    );
    checkLimits();
    expect(sent).toEqual([]);
    seed(
      [1, 2, 3, 4, 5, 6].flatMap((m) => [
        entry(`2026-0${m}-10`, 5000, "m"),
        entry(`2026-0${m}-11`, 1400, "a"),
      ]),
      jobs,
    );
    checkLimits();
    expect(limitFlags()).toEqual(["limit-rolling"]);
  });

  it("an ineligible user gets no limit-hours notification either", () => {
    seed(sixMonths("a"), [job("a", { employmentType: "hauptbeschaeftigung" })]);
    checkLimits();
    expect(limitFlags()).toEqual([]);
  });

  it("respects the user's notification settings and the browser permission", () => {
    for (const notifications of [{ limitAlerts: false }, { enabled: false }] as const) {
      sent.length = 0;
      window.localStorage.clear();
      seed(sixMonths(), [], {
        enabled: true,
        startReminder: false,
        endReminder: false,
        missingShift: false,
        backupReminder: false,
        payday: false,
        ...notifications,
      });
      runNotificationChecks();
      expect(limitFlags()).toEqual([]);
    }
    permission = "denied";
    window.localStorage.clear();
    seed(sixMonths(), [], {
      enabled: true,
      startReminder: false,
      endReminder: false,
      missingShift: false,
      backupReminder: false,
      payday: false,
    });
    runNotificationChecks();
    expect(sent).toEqual([]);
    expect(flags()).toEqual({}); // a failed send leaves no flag, so it is retried when permission is granted
    permission = "granted";
    runNotificationChecks();
    expect(limitFlags()).toEqual(["limit-rolling"]);
  });
});

describe("3b. CURRENT SHARED-GATE BEHAVIOUR (same as the dashboard; product decision pending)", () => {
  it("jobsApplyMinijobLimit also returns true when every job is archived, not only when there are no jobs", () => {
    expect(jobsApplyMinijobLimit([])).toBe(true);
    expect(jobsApplyMinijobLimit([job("a", { archived: true })])).toBe(true);
    expect(
      jobsApplyMinijobLimit([job("a", { employmentType: "hauptbeschaeftigung", archived: true })]),
    ).toBe(true);
  });

  it("so an archived Minijob alone still counts its earnings and can notify, exactly as the dashboard shows", () => {
    seed(
      [1, 2, 3, 4, 5, 6].map((m) => entry(`2026-0${m}-10`, 1400, "a")),
      [job("a", { archived: true })],
    );
    expect(dashboardLevel()).toBe("rollingAbove");
    checkLimits();
    expect(limitFlags()).toEqual(["limit-rolling"]);
  });

  it("an archived main employment alone counts nothing of its own; only unassigned entries can notify", () => {
    const jobs = [job("a", { employmentType: "hauptbeschaeftigung", archived: true })];
    seed(
      [1, 2, 3, 4, 5, 6].map((m) => entry(`2026-0${m}-10`, 1400, "a")),
      jobs,
    );
    checkLimits();
    expect(limitFlags()).toEqual([]);
  });
});
