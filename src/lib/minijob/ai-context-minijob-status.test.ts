/** KI-Kontext: Status „mehrere Minijobs neben Hauptbeschäftigung“ (nur Hinweis, keine Rechtsfolge). */
import { describe, expect, it } from "vitest";

import { buildSystemInstruction } from "@/lib/ai/gemini-provider";
import { buildAssistantContext } from "./ai-context";
import { DEFAULT_SETTINGS, type AppData, type Job, type Shift } from "./types";

const NOW = new Date(2026, 9, 26);

const job = (
  id: string,
  employmentType: NonNullable<Job["employmentType"]>,
  rate: number,
  startDate?: string,
): Job => ({
  id,
  name: `Name-${id}`,
  color: "#000",
  mode: "flex",
  rate,
  employmentType,
  ...(startDate ? { startDate } : {}),
});

const shift = (jobId: string, date: string): Shift => ({
  id: `${jobId}-${date}`,
  kind: "arbeit",
  date,
  start: "09:00",
  end: "13:00",
  breakMinutes: 0,
  jobId,
});

function ctx(jobs: Job[], shifts: Shift[] = []) {
  const data: AppData = {
    shifts,
    jobs,
    customers: [],
    projects: [],
    payments: [],
    goals: [],
    orders: [],
    objects: [],
    settings: { ...DEFAULT_SETTINGS },
    timer: null,
  };
  return JSON.parse(buildAssistantContext(data, NOW));
}

const HB = job("hb", "hauptbeschaeftigung", 20, "2020-01-01");
const A = job("a", "minijob", 13.9, "2024-03-01");
const B = job("b", "minijob", 15, "2025-06-01");

describe("buildAssistantContext — minijobStatus", () => {
  it("none: ein Minijob neben Hauptbeschäftigung → kein Status, keine Regeln", () => {
    expect(ctx([HB, A]).minijobStatus).toEqual({ status: "none", rules: [] });
  });

  it("none: mehrere Minijobs ohne Hauptbeschäftigung", () => {
    expect(ctx([A, B]).minijobStatus).toEqual({ status: "none", rules: [] });
  });

  it("order_known: voraussichtlich erster Minijob per Job-ID, mit vorsichtigen Regeln", () => {
    const status = ctx([HB, B, A]).minijobStatus;
    expect(status.status).toBe("order_known");
    expect(status.firstJobId).toBe("a");
    expect(status.furtherJobIds).toEqual(["b"]);
    const rules = status.rules.join(" ");
    expect(rules).toMatch(/nur der zeitlich zuerst aufgenommene Minijob geringfügig/);
    expect(rules).toMatch(/Behaupte daher nicht, dass alle Jobs Minijobs bleiben/);
    expect(rules).toMatch(/nach den Regeln der Sozialversicherung geprüft werden muss/);
    expect(rules).toMatch(/'voraussichtlich', nicht als sicher/);
  });

  it("order_unknown: Beginndatum fehlt → Reihenfolge offen, keine Erst-ID", () => {
    const status = ctx([HB, A, job("c", "minijob", 15)]).minijobStatus;
    expect(status.status).toBe("order_unknown");
    expect(status.jobIds).toEqual(["a", "c"]);
    expect(status).not.toHaveProperty("firstJobId");
    const rules = status.rules.join(" ");
    expect(rules).toMatch(/Behaupte daher nicht, dass alle Jobs Minijobs bleiben/);
    expect(rules).toMatch(/offen ist, welcher Minijob der erste ist/);
  });

  it("order_unknown: gleiche früheste Beginndaten", () => {
    const sameDay = job("d", "minijob", 15, "2024-03-01");
    expect(ctx([HB, A, sameDay]).minijobStatus.status).toBe("order_unknown");
  });

  it("überträgt nur Job-IDs aus jobs[], keine Beginndaten oder sonstigen Zusatzdaten", () => {
    const parsed = ctx([HB, B, A]);
    const ids = new Set(parsed.jobs.map((j: { id: string }) => j.id));
    const status = parsed.minijobStatus;
    for (const id of [status.firstJobId, ...status.furtherJobIds]) expect(ids.has(id)).toBe(true);
    expect(Object.keys(status).sort()).toEqual(["firstJobId", "furtherJobIds", "rules", "status"]);
    const raw = JSON.stringify(parsed);
    for (const date of ["2020-01-01", "2024-03-01", "2025-06-01"]) expect(raw).not.toContain(date);
  });

  it("Hauptbeschäftigung zählt nicht zur Minijob-Summe; Berechnung bleibt unverändert", () => {
    const parsed = ctx(
      [HB, A, B],
      [shift("hb", "2026-10-05"), shift("a", "2026-10-06"), shift("b", "2026-10-07")],
    );
    // HB 4 h × 20 € = 80 €, A 4 h × 13,90 € = 55,60 €, B 4 h × 15 € = 60 €
    expect(parsed.currentMonth.earnings).toBe(195.6);
    expect(parsed.forecast.minijobEarningsEntered).toBe(115.6);
    expect(parsed.forecast.remainingLimitAmount).toBe(
      Number((parsed.settings.legalMonthlyLimit - 115.6).toFixed(2)),
    );
    expect(parsed.minijobStatus.status).toBe("order_known");
  });

  it("System-Prompt verweist auf minijobStatus.rules", () => {
    expect(buildSystemInstruction("Deutsch")).toMatch(/Befolge außerdem minijobStatus\.rules/);
  });
});
