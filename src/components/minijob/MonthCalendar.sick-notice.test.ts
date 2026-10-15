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

/* ---- QA P3-R2-144-b (M144-18): Render-Test der Komponente ---- */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

import { MonthCalendar } from "./MonthCalendar";
import { tl } from "@/lib/i18n";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function renderCalendar(shifts: Shift[], r = resolve, jobs: Job[] = [job]) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() =>
    root.render(
      createElement(MonthCalendar, {
        year: 2026,
        month: 10,
        shifts,
        jobs,
        bundesland: "NW",
        resolve: r,
        onChangeMonth: () => {},
        onSelectDay: () => {},
      }),
    ),
  );
  const flagged = [...host.querySelectorAll<HTMLButtonElement>("button[data-pay-notice]")].map(
    (b) => ({
      day: b.querySelector(":scope > span > span")?.textContent,
      notice: b.getAttribute("data-pay-notice"),
      title: b.getAttribute("title") ?? "",
    }),
  );
  act(() => root.unmount());
  host.remove();
  return flagged;
}

describe("MonthCalendar Komponente rendert den Hinweis (M144-18)", () => {
  it("sick-case-ambiguous nur am 04.11., mit übersetztem Titel", () => {
    const flagged = renderCalendar([sick("2026-11-02"), sick("2026-11-04")]);
    expect(flagged).toHaveLength(1);
    expect(flagged[0]!.day).toBe("4");
    expect(flagged[0]!.notice).toBe("sick-case-ambiguous");
    expect(flagged[0]!.title).toContain(tl("de", "pay.notice.sick-case-ambiguous"));
  });

  it("sick-legacy-over-limit (Monat nicht bestätigt) im Kalender", () => {
    const all = Array.from({ length: 45 }, (_, i) => {
      const d = new Date(2026, 9, 1 + i);
      return sick(
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
      );
    }); // 01.10.–14.11.; Tage 43–45 = 12.–14.11.
    const flagged = renderCalendar(all);
    expect(flagged.map((f) => f.day)).toEqual(["12", "13", "14"]);
    expect(new Set(flagged.map((f) => f.notice))).toEqual(new Set(["sick-legacy-over-limit"]));
  });

  it("ohne Hinweis kein data-pay-notice", () => {
    expect(renderCalendar([sick("2026-11-02")])).toEqual([]);
  });
});
