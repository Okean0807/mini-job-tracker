/**
 * P3-5 / P3-B: Start-Datum-Guard des Arbeitszeitkontos (`planForDate`) ist
 * zeitzonenfest. Läuft im vitest-Projekt "tz-la" (TZ=America/Los_Angeles, auch
 * im CI-Job `unit` via `bun run test`). Zusätzlich wird dieselbe Prüfung im
 * selben Prozess für Zonen vor UTC wiederholt (TZ wird danach zurückgesetzt),
 * damit Date-basierte Vergleiche (UTC- vs. lokale Mitternacht) in beide
 * Richtungen auffallen. Erwartung: reiner Kalendertag-Vergleich – vor dem
 * Startdatum 0 Soll, ab dem Starttag (inklusive) Plan-Soll.
 */
import { afterAll, describe, expect, it } from "vitest";

import { daySollHours, monthTimeAccount } from "./fest-time-account";
import { EMPTY_WEEK, type Job } from "./types";

const ORIGINAL_TZ = process.env["TZ"];
function restoreTz() {
  if (ORIGINAL_TZ === undefined) delete process.env["TZ"];
  else process.env["TZ"] = ORIGINAL_TZ;
}

function job(startDate: string): Job {
  return {
    id: "jtz",
    name: "Fest TZ",
    color: "#000",
    mode: "fest",
    rate: 15,
    week: EMPTY_WEEK.map((d) => ({ ...d })),
    weeklyTarget: 37.5,
    startDate,
  };
}

const open: Job = { ...job("2000-01-01") };

function assertGuard() {
  // Mi 03.06.2026: Vortag 0, Starttag = Plan-Soll
  const mid = job("2026-06-03");
  expect(daySollHours(mid, "2026-06-02")).toBe(0);
  expect(daySollHours(mid, "2026-06-03")).toBeGreaterThan(0);
  expect(daySollHours(mid, "2026-06-03")).toBe(daySollHours(open, "2026-06-03"));
  // Monatserster (Mi 01.07.2026): Vormonatsletzter 0, Erster aktiv
  const first = job("2026-07-01");
  expect(daySollHours(first, "2026-06-30")).toBe(0);
  expect(daySollHours(first, "2026-07-01")).toBe(daySollHours(open, "2026-07-01"));
  // Monat mit Start: genau Mo 01.06. + Di 02.06. fehlen
  const june = monthTimeAccount(mid, 2026, 5, []);
  const juneOpen = monthTimeAccount(open, 2026, 5, []);
  expect(june.workDays).toBe(juneOpen.workDays - 2);
  // US-DST-Wechsel (So 08.03.2026): Start Mo 09.03., Fr 06.03. = 0
  const dst = job("2026-03-09");
  expect(daySollHours(dst, "2026-03-06")).toBe(0);
  expect(daySollHours(dst, "2026-03-09")).toBe(daySollHours(open, "2026-03-09"));
}

afterAll(restoreTz);

describe("planForDate Start-Guard in America/Los_Angeles", () => {
  it("TZ ist wirklich hinter UTC", () => {
    expect(new Date(2026, 5, 3, 12).getTimezoneOffset()).toBe(420);
  });

  it("vor Start 0 Soll, ab Starttag Plan-Soll", () => {
    assertGuard();
  });
});

describe("planForDate Start-Guard in Zonen vor UTC (gleicher Prozess)", () => {
  it.each([
    ["Europe/Berlin", -120],
    ["Pacific/Kiritimati", -840],
  ])("%s", (tz, offset) => {
    process.env["TZ"] = tz;
    try {
      expect(new Date(2026, 5, 3, 12).getTimezoneOffset()).toBe(offset);
      assertGuard();
    } finally {
      restoreTz();
    }
  });
});
