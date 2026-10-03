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
    expect(flags["limit-100"]).toBe(localMonth);
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
    expect(flags()["limit-100"]).toBe(isoDate(new Date()).slice(0, 7));
  });

  it("E: fest + explizit Minijob → Benachrichtigung (Planungsmodus egal)", () => {
    seed({ id: "mini", name: "Plan-Mini", color: "#000", mode: "fest", employmentType: "minijob" });
    checkLimits();
    expect(flags()["limit-100"]).toBe(isoDate(new Date()).slice(0, 7));
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
        // Altbestand fest: 10 h × 20 € = 200 € – würde mitgezählt „limit-100“ auslösen
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
