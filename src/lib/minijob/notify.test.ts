import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isoDate } from "./calc";
import { checkLimits } from "./notify";
import { replaceAll } from "./store";
import { DEFAULT_SETTINGS, type Job, type Shift } from "./types";

const FLAG_KEY = "minijob-notify-flags";

beforeEach(() => {
  window.localStorage.clear();
  // notifyOnce stempelt nur nach erfolgreichem Senden → Notification-API erlauben.
  class FakeNotification {
    static permission: NotificationPermission = "granted";
    constructor(_title: string, _options?: NotificationOptions) {}
  }
  vi.stubGlobal("Notification", FakeNotification);
  const date = isoDate(new Date());
  const shift = {
    id: "s1",
    date,
    start: "08:00",
    end: "18:00",
    breakMinutes: 0,
    kind: "arbeit",
    rate: 20,
  } as Shift;
  replaceAll({
    shifts: [shift],
    jobs: [],
    settings: {
      ...DEFAULT_SETTINGS,
      defaultRate: 20,
      limitAuto: false,
      monthlyLimit: 100,
      hoursLimitAuto: false,
      hoursLimitMonthly: 100,
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("checkLimits Monatsstempel", () => {
  it("verwendet den lokalen Monat via isoDate, nicht UTC-ISO", () => {
    checkLimits();
    const flags = JSON.parse(window.localStorage.getItem(FLAG_KEY) ?? "{}") as Record<
      string,
      string
    >;
    const localMonth = isoDate(new Date()).slice(0, 7);
    // 200 EUR against a manual 100 EUR monthly reference (annual 1,200 EUR): a month above the
    // reference, not an exceedance of the annual limit.
    expect(flags["limit-month-above"]).toBe(localMonth);
    expect(flags["limit-100"]).toBeUndefined();
  });
});

describe("checkLimits – Beschäftigungsart", () => {
  function seed(job: Job) {
    const shift = {
      id: "s-job",
      jobId: job.id,
      date: isoDate(new Date()),
      start: "08:00",
      end: "18:00",
      breakMinutes: 0,
      kind: "arbeit",
      rate: 20,
    } as Shift;
    replaceAll({
      shifts: [shift],
      jobs: [job],
      settings: {
        ...DEFAULT_SETTINGS,
        defaultRate: 20,
        limitAuto: false,
        monthlyLimit: 100,
        hoursLimitAuto: false,
        hoursLimitMonthly: 5,
      },
    });
  }
  const flags = () =>
    JSON.parse(window.localStorage.getItem(FLAG_KEY) ?? "{}") as Record<string, string>;

  it("B: Altbestand fest ohne employmentType → keine Grenz-Benachrichtigung", () => {
    seed({ id: "legacy", name: "Alt-Fest", color: "#000", mode: "fest" });
    checkLimits();
    expect(Object.keys(flags()).filter((k) => k.startsWith("limit-"))).toEqual([]);
  });

  it("A: Altbestand flex ohne employmentType → Minijob, Benachrichtigung wie bisher", () => {
    seed({ id: "legacy", name: "Alt-Flex", color: "#000", mode: "flex" });
    checkLimits();
    expect(flags()["limit-month-above"]).toBe(isoDate(new Date()).slice(0, 7));
  });

  it("E: fest + explizit Minijob → Benachrichtigung (Planungsmodus egal)", () => {
    seed({ id: "mini", name: "Plan-Mini", color: "#000", mode: "fest", employmentType: "minijob" });
    checkLimits();
    expect(flags()["limit-month-above"]).toBe(isoDate(new Date()).slice(0, 7));
  });

  it("B (gemischt): ungeklärter Altbestand fest zählt nicht in die Summe des echten Minijobs", () => {
    const today = isoDate(new Date());
    replaceAll({
      shifts: [
        // Minijob: 1 h × 20 € = 20 € (20 % von 100 €) → allein keine Stufe
        {
          id: "mini",
          jobId: "mini",
          date: today,
          start: "08:00",
          end: "09:00",
          breakMinutes: 0,
          kind: "arbeit",
          rate: 20,
        } as Shift,
        // Altbestand fest: 10 h × 20 € = 200 € – würde mitgezählt einen Limit-Hinweis auslösen
        {
          id: "legacy",
          jobId: "legacy",
          date: today,
          start: "08:00",
          end: "18:00",
          breakMinutes: 0,
          kind: "arbeit",
          rate: 20,
        } as Shift,
      ],
      jobs: [
        { id: "mini", name: "Mini", color: "#000", mode: "flex", employmentType: "minijob" },
        { id: "legacy", name: "Alt-Fest", color: "#000", mode: "fest" },
      ],
      settings: {
        ...DEFAULT_SETTINGS,
        defaultRate: 20,
        limitAuto: false,
        monthlyLimit: 100,
        hoursLimitAuto: false,
        hoursLimitMonthly: 100,
      },
    });
    checkLimits();
    expect(Object.keys(flags()).filter((k) => k.startsWith("limit-"))).toEqual([]);
  });

  it("Gate wie Dashboard: nur Hauptbeschäftigung + nicht zugeordnete Alt-Schicht → keine Benachrichtigung", () => {
    replaceAll({
      shifts: [
        {
          id: "unassigned",
          date: isoDate(new Date()),
          start: "08:00",
          end: "18:00",
          breakMinutes: 0,
          kind: "arbeit",
          rate: 20,
        } as Shift,
      ],
      jobs: [
        {
          id: "main",
          name: "Haupt",
          color: "#000",
          mode: "flex",
          employmentType: "hauptbeschaeftigung",
        },
      ],
      settings: {
        ...DEFAULT_SETTINGS,
        defaultRate: 20,
        limitAuto: false,
        monthlyLimit: 100,
        hoursLimitAuto: false,
        hoursLimitMonthly: 100,
      },
    });
    checkLimits();
    expect(Object.keys(flags()).filter((k) => k.startsWith("limit-"))).toEqual([]);
  });

  it("D: flex + Hauptbeschäftigung → keine Grenz-Benachrichtigung", () => {
    seed({
      id: "main",
      name: "Haupt",
      color: "#000",
      mode: "flex",
      employmentType: "hauptbeschaeftigung",
    });
    checkLimits();
    expect(Object.keys(flags()).filter((k) => k.startsWith("limit-"))).toEqual([]);
  });
});

describe("checkLimits – AUD-09A: Grenzen sind Obergrenzen, ein einzelner Monat ist keine Überschreitung", () => {
  const flags = () =>
    JSON.parse(window.localStorage.getItem(FLAG_KEY) ?? "{}") as Record<string, string>;
  const limitFlags = () =>
    Object.keys(flags())
      .filter((k) => k.startsWith("limit-"))
      .sort();
  let n = 0;
  const entry = (date: string, amount: number): Shift =>
    ({
      id: `e${n++}`,
      date,
      start: "08:00",
      end: "09:00",
      breakMinutes: 0,
      kind: "arbeit",
      rate: amount, // 1 h -> earnings == amount
    }) as Shift;
  function seed(today: Date, shifts: Shift[]) {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(today);
    replaceAll({ shifts, jobs: [], settings: { ...DEFAULT_SETTINGS, limitAuto: true } });
  }
  afterEach(() => {
    vi.useRealTimers();
  });

  const JUNE_2026 = new Date(2026, 5, 15, 10, 0);
  const FEB_2027 = new Date(2027, 1, 10, 10, 0);

  it("2026: 602.99 and 603.00 EUR are informative only (90 %), never 'exceeded'", () => {
    seed(JUNE_2026, [entry("2026-06-10", 602.99)]);
    checkLimits();
    expect(limitFlags()).toEqual(["limit-90"]);
    window.localStorage.clear();
    seed(JUNE_2026, [entry("2026-06-10", 603)]);
    checkLimits();
    expect(limitFlags()).toEqual(["limit-90"]);
  });

  it("2026: 603.01 EUR is a month above the reference, not a legal exceedance", () => {
    seed(JUNE_2026, [entry("2026-06-10", 603.01)]);
    checkLimits();
    expect(limitFlags()).toEqual(["limit-month-above"]);
  });

  it("2027: 633.00 EUR is within the limit, 633.01 EUR is a month above the reference", () => {
    seed(FEB_2027, [entry("2027-02-03", 633)]);
    checkLimits();
    expect(limitFlags()).toEqual(["limit-90"]);
    window.localStorage.clear();
    seed(FEB_2027, [entry("2027-02-03", 633.01)]);
    checkLimits();
    expect(limitFlags()).toEqual(["limit-month-above"]);
  });

  it("one month at 1,000 EUR with a compliant annual assessment: hint, no 'exceeded'", () => {
    seed(JUNE_2026, [entry("2026-06-10", 1000)]);
    checkLimits();
    expect(limitFlags()).toEqual(["limit-month-above"]);
    expect(flags()["limit-100"]).toBeUndefined();
  });

  it("the rolling 12-month indicator above its reference range notifies, as an orientation hint", () => {
    // January to June 1,300 EUR each = 7,800 EUR > 7,236 EUR
    const shifts = [1, 2, 3, 4, 5, 6].map((m) => entry(`2026-0${m}-10`, 1300));
    seed(JUNE_2026, shifts);
    checkLimits();
    expect(limitFlags()).toEqual(["limit-rolling"]);
    // the calendar-year figure alone is never reported, and the retired "exceeded" flag is gone
    expect(flags()["limit-100"]).toBeUndefined();
  });

  it("an extreme month inside a compliant total is not announced as an exceedance", () => {
    seed(JUNE_2026, [entry("2026-06-10", 1400)]);
    checkLimits();
    expect(limitFlags()).toEqual(["limit-month-above"]);
    expect(flags()["limit-rolling"]).toBeUndefined();
    expect(flags()["limit-100"]).toBeUndefined();
  });

  it("an indicator above its range because of entered future shifts notifies the same hint as the card", () => {
    // 3,600 EUR actual, plus 7,000 EUR planned later this month -> 10,600 EUR projected
    const shifts = [1, 2, 3, 4, 5, 6].map((m) => entry(`2026-0${m}-10`, 600));
    shifts.push(entry("2026-06-25", 7000));
    seed(JUNE_2026, shifts);
    checkLimits();
    expect(limitFlags()).toEqual(["limit-rolling"]);
  });
});
