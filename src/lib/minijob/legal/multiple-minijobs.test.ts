import { describe, expect, it } from "vitest";

import { monthUsage } from "../limits";
import { makeResolver } from "../resolve";
import { DEFAULT_SETTINGS, type Job, type Shift } from "../types";
import { multipleMinijobsBesideMainJob } from "./employment";

const job = (
  id: string,
  employmentType: NonNullable<Job["employmentType"]>,
  extra: Partial<Job> = {},
): Job => ({
  id,
  name: id,
  color: "#000",
  mode: "flex",
  rate: 15,
  employmentType,
  ...extra,
});

const DATE = "2026-10-26";
const HB = job("HB", "hauptbeschaeftigung", { startDate: "2020-01-01" });
const A = job("A", "minijob", { startDate: "2024-03-01" });
const B = job("B", "minijob", { startDate: "2025-06-01" });
const C = job("C", "minijob", { startDate: "2026-02-01" });

describe("multipleMinijobsBesideMainJob — Hinweis, keine Rechtsfolge", () => {
  it("none: kein Minijob, ein Minijob oder keine Hauptbeschäftigung", () => {
    expect(multipleMinijobsBesideMainJob([HB], DATE).status).toBe("none");
    expect(multipleMinijobsBesideMainJob([HB, A], DATE).status).toBe("none");
    expect(multipleMinijobsBesideMainJob([A, B, C], DATE).status).toBe("none");
  });

  it("order_known: zeitlich zuerst aufgenommener Minijob, unabhängig von der Reihenfolge der Liste", () => {
    expect(multipleMinijobsBesideMainJob([HB, C, B, A], DATE)).toEqual({
      status: "order_known",
      firstJobId: "A",
      furtherJobIds: ["B", "C"],
    });
  });

  it("order_unknown: ein Beginndatum fehlt", () => {
    const noStart = job("X", "minijob");
    expect(multipleMinijobsBesideMainJob([HB, A, noStart], DATE)).toEqual({
      status: "order_unknown",
      jobIds: ["A", "X"],
    });
  });

  it("order_unknown: frühestes Beginndatum ist nicht eindeutig", () => {
    const sameDay = job("Y", "minijob", { startDate: "2024-03-01" });
    expect(multipleMinijobsBesideMainJob([HB, A, sameDay, C], DATE).status).toBe("order_unknown");
  });

  it("nur am Datum aktive, nicht archivierte Jobs zählen", () => {
    const ended = job("E", "minijob", { startDate: "2020-01-01", endDate: "2026-06-30" });
    const archived = job("R", "minijob", { startDate: "2019-01-01", archived: true });
    expect(multipleMinijobsBesideMainJob([HB, ended, archived, B], DATE).status).toBe("none");
    expect(multipleMinijobsBesideMainJob([HB, ended, B, C], DATE)).toMatchObject({
      status: "order_known",
      firstJobId: "B",
    });
    const hbEnded = { ...HB, endDate: "2026-01-31" };
    expect(multipleMinijobsBesideMainJob([hbEnded, A, B], DATE).status).toBe("none");
  });

  it("ungeklärte Altbestände (fest ohne Art) und andere Arten zählen nicht als Minijob", () => {
    const legacyFest: Job = {
      id: "L",
      name: "L",
      color: "#000",
      mode: "fest",
      startDate: "2023-01-01",
    };
    const kurz = job("K", "kurzfristig", { startDate: "2023-01-01" });
    expect(multipleMinijobsBesideMainJob([HB, A, legacyFest, kurz], DATE).status).toBe("none");
  });

  it("die Grenzberechnung bleibt unverändert: alle Minijobs zählen zusammen, HB nicht", () => {
    const shifts: Shift[] = ["A", "B", "HB"].map((jobId) => ({
      id: jobId,
      kind: "arbeit",
      date: "2026-10-05",
      start: "09:00",
      end: "13:00",
      breakMinutes: 0,
      jobId,
    }));
    const jobs = [HB, A, B];
    const usage = monthUsage(
      shifts,
      makeResolver(jobs, DEFAULT_SETTINGS),
      DEFAULT_SETTINGS,
      2026,
      9,
      DATE,
    );
    expect(usage.earnings).toBe(120); // 2 × 4 h × 15 €, ohne Hauptbeschäftigung
  });
});
