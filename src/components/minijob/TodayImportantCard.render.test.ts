/**
 * Render-Test (react-dom/client + act, happy-dom) der Heute-Karte:
 * - B1: flex-Job mit EMPTY_WEEK ist nicht „heute geplant“
 * - ungeklärter Altbestand fest → Hinweis „Beschäftigungsart wählen“, keine Grenzwarnung
 * - 85-%-Schwelle (Business/UX) wie Dashboard-Banner
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, className }: { to: string; children?: unknown; className?: string }) =>
    createElement("a", { href: to, className }, children as never),
}));

import { TodayImportantCard } from "./TodayImportantCard";
import { t } from "@/lib/i18n";
import { makeResolver } from "@/lib/minijob/resolve";
import { DEFAULT_SETTINGS, EMPTY_WEEK, type Job, type Shift } from "@/lib/minijob/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TODAY = "2026-09-30"; // Mittwoch
const settings = { ...DEFAULT_SETTINGS, defaultRate: 15 };
const usage = (share: number) => ({ share, earnings: 0, earningsLimit: 603 });

let container: HTMLDivElement;
let root: Root;

function render(jobs: Job[], shifts: Shift[] = [], share = 0) {
  act(() => {
    root.render(
      createElement(TodayImportantCard, {
        shifts,
        jobs,
        payments: [],
        settings,
        resolve: makeResolver(jobs, settings),
        monthUsage: usage(share),
        yearUsage: usage(0),
        onNewEntry: () => {},
      }),
    );
  });
  return container.textContent ?? "";
}

const planned = () => t("dash.todayPlanned");
const job = (overrides: Partial<Job>): Job => ({
  id: "j1",
  name: "Reinigung",
  color: "#000",
  mode: "flex",
  rate: 15,
  ...overrides,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 8, 30, 10, 0));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe("TodayImportantCard – heute geplant", () => {
  it("B1: flex job with EMPTY_WEEK (as JobDialog writes it) is NOT planned today", () => {
    expect(
      render([job({ mode: "flex", week: EMPTY_WEEK, employmentType: "minijob" })]),
    ).not.toContain(planned());
  });

  it("fest job with today active and nothing recorded IS planned", () => {
    expect(render([job({ mode: "fest", week: EMPTY_WEEK, employmentType: "minijob" })])).toContain(
      planned(),
    );
  });

  it("fest job already recorded today or archived is not planned", () => {
    const fest = job({ mode: "fest", week: EMPTY_WEEK, employmentType: "minijob" });
    const entry: Shift = {
      id: "s",
      jobId: "j1",
      kind: "arbeit",
      date: TODAY,
      start: "09:00",
      end: "12:00",
      breakMinutes: 0,
    };
    expect(render([fest], [entry])).not.toContain(planned());
    expect(render([{ ...fest, archived: true }])).not.toContain(planned());
  });
});

describe("TodayImportantCard – Beschäftigungsart / Grenze", () => {
  it("B: legacy fest without employmentType → hint to choose, no limit warning", () => {
    const text = render([job({ mode: "fest", name: "Alt-Fest" })], [], 120);
    expect(text).toContain(t("dash.todayEmploymentType", { names: "Alt-Fest" }));
    expect(text).not.toContain(t("dash.todayLimit", { percent: 120 }));
  });

  it("A: legacy flex without employmentType → no hint (fallback Minijob)", () => {
    expect(render([job({ mode: "flex", name: "Alt-Flex" })])).not.toContain(
      t("dash.todayEmploymentType", { names: "Alt-Flex" }),
    );
  });

  it("85 % threshold (Business/UX): 84 % no warning, 85 % warning", () => {
    const mini = [job({ employmentType: "minijob" })];
    expect(render(mini, [], 84)).not.toContain(t("dash.todayLimit", { percent: 84 }));
    expect(render(mini, [], 85)).toContain(t("dash.todayLimit", { percent: 85 }));
  });

  it("only Hauptbeschäftigung → no limit warning even at a high share", () => {
    const main = [job({ employmentType: "hauptbeschaeftigung" })];
    expect(render(main, [], 95)).not.toContain(t("dash.todayLimit", { percent: 95 }));
  });
});
