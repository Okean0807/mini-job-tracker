/** QA P2-144-a: MonthCalendar zeigt den Krankheitsfall-Hinweis im Tages-Titel. */
import { describe, expect, it } from "vitest";

import { buildDayTitle, dayPayNotice } from "./MonthCalendar";
import type { Job, Shift } from "@/lib/minijob/types";

const day = { start: "09:00", end: "14:00", breakMinutes: 0 };
const job = {
  id: "j1",
  name: "Job",
  rate: 15,
  color: "#000",
  week: Array.from({ length: 7 }, () => ({ active: true, ...day })),
  startDate: "2025-01-01",
} as unknown as Job;
const sick = (date: string): Shift =>
  ({ id: `k-${date}`, jobId: "j1", kind: "krank", date, ...day }) as Shift;
const resolve = () => ({ job, defaultRate: 15 });

describe("MonthCalendar Hinweis", () => {
  it("dayPayNotice liefert den Hinweis des Krankheitstags", () => {
    const all = [sick("2026-11-02"), sick("2026-11-04")];
    expect(dayPayNotice([all[1]!], all, resolve)).toBe("sick-case-ambiguous");
    expect(dayPayNotice([all[0]!], all, resolve)).toBeUndefined();
  });

  it("buildDayTitle hängt den Hinweis an", () => {
    const title = buildDayTitle({
      kind: "krank",
      hours: 5,
      earnings: 75,
      kindLabel: (k) => k,
      notice: "Hinweis",
    });
    expect(title.endsWith("Hinweis")).toBe(true);
  });
});
