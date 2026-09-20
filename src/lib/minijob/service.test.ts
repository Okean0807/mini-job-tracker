import { beforeEach, describe, expect, it } from "vitest";

import { isoDate, shiftHours, timeFromDate } from "./calc";
import { payrollTotals } from "./payroll";
import {
  addShift,
  earningsOf,
  getShift,
  listShifts,
  monthStats,
  removeShift,
  updateShift,
  upsertShift,
} from "./service";
import { getData, replaceAll, saveShift } from "./store";
import { DEFAULT_SETTINGS, type Shift } from "./types";

const base = {
  kind: "arbeit" as const,
  date: "2026-03-04",
  start: "09:00",
  end: "17:00",
  breakMinutes: 30,
  rate: 12,
};

beforeEach(() => {
  replaceAll({ shifts: [], jobs: [], settings: { ...DEFAULT_SETTINGS } });
});

describe("service shift CRUD", () => {
  it("legt eine Schicht mit ID, kind und createdAt an", () => {
    const shift = addShift(base);
    expect(shift.id).toBeTruthy();
    expect(shift.kind).toBe("arbeit");
    expect(shift.createdAt).toBe(isoDate(new Date()));
    expect(getData().shifts).toHaveLength(1);
    expect(getShift(shift.id)).toEqual(shift);
    expect(shiftHours(shift)).toBe(7.5);
    expect(earningsOf(shift).total).toBe(90);
  });

  it("aktualisiert eine Schicht teilweise und behält die ID", () => {
    const shift = addShift(base);
    const updated = updateShift(shift.id, { end: "19:00", rate: 15 });
    expect(updated?.id).toBe(shift.id);
    expect(updated?.start).toBe("09:00");
    expect(getData().shifts).toHaveLength(1);
    const stored = getShift(shift.id)!;
    expect(shiftHours(stored)).toBe(9.5);
    expect(earningsOf(stored).total).toBeCloseTo(142.5, 10);
  });

  it("gibt undefined zurück, wenn die Schicht nicht existiert", () => {
    expect(updateShift("fehlt", { rate: 20 })).toBeUndefined();
  });

  it("überschreibt per upsert vollständig, ohne die ID zu ändern", () => {
    const shift = addShift(base);
    const replaced = upsertShift({
      ...base,
      id: shift.id,
      date: "2026-03-05",
      start: "08:00",
      end: "12:00",
      breakMinutes: 0,
      rate: 10,
    });
    expect(replaced.id).toBe(shift.id);
    expect(getData().shifts).toHaveLength(1);
    expect(getShift(shift.id)?.date).toBe("2026-03-05");
    expect(earningsOf(replaced).total).toBe(40);
  });

  it("löscht eine Schicht", () => {
    const a = addShift(base);
    const b = addShift({ ...base, date: "2026-03-05" });
    removeShift(a.id);
    expect(getData().shifts.map((s) => s.id)).toEqual([b.id]);
    expect(getShift(a.id)).toBeUndefined();
  });

  it("filtert Schichten nach Zeitraum", () => {
    addShift({ ...base, date: "2026-03-01" });
    addShift({ ...base, date: "2026-03-10" });
    addShift({ ...base, date: "2026-04-01" });
    expect(listShifts({ from: "2026-03-01", to: "2026-03-31" })).toHaveLength(2);
  });
});

describe("Timer-Regression (service.addShift)", () => {
  it("speichert eine getimte Schicht inkl. createdAt und Pause", () => {
    const startedAt = new Date(2026, 2, 4, 9, 5);
    const stoppedAt = new Date(2026, 2, 4, 13, 35);
    // identisch zur Logik in WorkTimer.stop()
    const shift: Shift = addShift({
      kind: "arbeit",
      date: isoDate(startedAt),
      start: timeFromDate(startedAt),
      end: timeFromDate(stoppedAt),
      breakMinutes: 30,
      rate: 12,
      jobId: "job-1",
    });

    expect(shift.date).toBe("2026-03-04");
    expect(shift.start).toBe("09:05");
    expect(shift.end).toBe("13:35");
    expect(shift.jobId).toBe("job-1");
    expect(shift.kind).toBe("arbeit");
    expect(shift.createdAt).toBe(isoDate(new Date()));
    expect(shiftHours(shift)).toBe(4);
    expect(earningsOf(shift).total).toBe(48);
    expect(getData().shifts).toHaveLength(1);
  });

  it("übernimmt eine Timer-Schicht über Mitternacht korrekt", () => {
    const startedAt = new Date(2026, 2, 4, 22, 0);
    const stoppedAt = new Date(2026, 2, 5, 2, 0);
    const shift = addShift({
      kind: "arbeit",
      date: isoDate(startedAt),
      start: timeFromDate(startedAt),
      end: timeFromDate(stoppedAt),
      breakMinutes: 0,
      rate: 12,
    });
    expect(shift.date).toBe("2026-03-04");
    expect(shiftHours(shift)).toBe(4);
    expect(shift.createdAt).toBe(isoDate(new Date()));
  });
});


describe("FLEX multi arbeit same calendar day", () => {
  beforeEach(() => {
    replaceAll({
      shifts: [],
      jobs: [{ id: "j1", name: "Café", color: "#0d9488", mode: "flex", rate: 12 }],
      settings: { ...DEFAULT_SETTINGS, defaultRate: 12 },
    });
  });

  it("saveShift does not overwrite by date — keeps distinct ids", () => {
    saveShift({
      id: "a",
      kind: "arbeit",
      date: "2026-09-15",
      start: "08:00",
      end: "12:00",
      breakMinutes: 0,
      rate: 12,
      jobId: "j1",
    });
    saveShift({
      id: "b",
      kind: "arbeit",
      date: "2026-09-15",
      start: "14:00",
      end: "17:00",
      breakMinutes: 0,
      rate: 12,
      jobId: "j1",
    });
    saveShift({
      id: "c",
      kind: "arbeit",
      date: "2026-09-15",
      start: "18:00",
      end: "20:00",
      breakMinutes: 0,
      rate: 12,
      jobId: "j1",
    });
    expect(getData().shifts).toHaveLength(3);
    expect(getData().shifts.map((s) => s.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("monthStats and payrollTotals sum 2–3 arbeit on same date", () => {
    addShift({
      kind: "arbeit",
      date: "2026-09-15",
      start: "08:00",
      end: "12:00",
      breakMinutes: 0,
      rate: 12,
      jobId: "j1",
    });
    addShift({
      kind: "arbeit",
      date: "2026-09-15",
      start: "14:00",
      end: "17:00",
      breakMinutes: 0,
      rate: 12,
      jobId: "j1",
    });
    addShift({
      kind: "arbeit",
      date: "2026-09-15",
      start: "18:00",
      end: "20:00",
      breakMinutes: 0,
      rate: 12,
      jobId: "j1",
    });
    // 4 + 3 + 2 = 9h, 9 * 12 = 108
    const m = monthStats(2026, 8);
    expect(m.entries).toBe(3);
    expect(m.hours).toBe(9);
    expect(m.earnings).toBeCloseTo(108, 10);
    expect(m.payroll.workedHours).toBe(9);
    expect(m.payroll.earnings).toBeCloseTo(108, 10);

    const all = getData().shifts;
    const totals = payrollTotals(all, (s) => ({ job: getData().jobs[0], defaultRate: 12 }), all);
    expect(totals.workedHours).toBe(9);
    expect(totals.earnings).toBeCloseTo(108, 10);
  });
});
