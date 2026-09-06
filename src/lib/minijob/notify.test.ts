import { beforeEach, describe, expect, it } from "vitest";

import { isoDate } from "./calc";
import { checkLimits } from "./notify";
import { replaceAll } from "./store";
import { DEFAULT_SETTINGS, type Shift } from "./types";

const FLAG_KEY = "minijob-notify-flags";

beforeEach(() => {
  window.localStorage.clear();
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
