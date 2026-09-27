/**
 * GoalsCard – Accessible Names der Progressbars (axe: aria-progressbar-name).
 * Echter Render (react-dom/client + act, happy-dom; keine neue Dependency).
 * Name nach aria-labelledby: Textinhalt der referenzierten Elemente.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GoalsCard } from "./GoalsCard";
import type { GoalProgress } from "@/lib/minijob/goals";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function gp(id: string, name: string, target: number, saved: number): GoalProgress {
  const share = target > 0 ? (saved / target) * 100 : 0;
  return {
    goal: { id, name, target, kind: "manual", manualSaved: saved },
    saved,
    share,
    remaining: Math.max(0, target - saved),
    reached: target > 0 && saved >= target,
  };
}

const GOALS = [
  gp("g1", "Urlaub sparen", 100, 50),
  gp("g2", "Null-Ziel", 0, 10),
  gp("g3", "Fahrrad", 100, 150),
];

let container: HTMLDivElement;
let root: Root;

function nameOf(el: Element): string {
  const ids = (el.getAttribute("aria-labelledby") ?? "").split(/\s+/).filter(Boolean);
  return ids
    .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
    .filter(Boolean)
    .join(" ");
}
function bars(): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('[role="progressbar"]')];
}
function visibleGoalName(bar: Element): string {
  return bar.closest("li")!.querySelector("span.font-medium")!.textContent!.trim();
}
function markupWithoutA11yIds(): string {
  const clone = container.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("[id]").forEach((e) => e.removeAttribute("id"));
  clone.querySelectorAll("[aria-labelledby]").forEach((e) => e.removeAttribute("aria-labelledby"));
  return clone.innerHTML;
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(createElement(GoalsCard, { goals: GOALS, jobs: [] }));
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("GoalsCard progressbar accessible names", () => {
  it("jeder Balken heißt wie der sichtbare Zielname; Namen eindeutig", () => {
    expect(bars()).toHaveLength(3);
    const names = bars().map((b) => {
      const name = nameOf(b);
      expect(name).not.toBe("");
      expect(name).toBe(visibleGoalName(b));
      return name;
    });
    expect(names).toEqual(GOALS.map((g) => g.goal.name));
    expect(new Set(names).size).toBe(3);
  });

  it("referenzierte IDs existieren und sind eindeutig", () => {
    const allIds = [...container.querySelectorAll("[id]")].map((e) => e.id);
    expect(allIds).toHaveLength(3);
    expect(new Set(allIds).size).toBe(3);
    const refs = bars().map((b) => b.getAttribute("aria-labelledby")!);
    expect(new Set(refs).size).toBe(3);
    for (const [i, id] of refs.entries()) {
      const el = document.getElementById(id);
      expect(el).not.toBeNull();
      expect(bars()[i]!.closest("li")!.contains(el)).toBe(true);
    }
  });

  it("aria-valuenow 50 / 0 / 100 bleibt erhalten", () => {
    expect(bars().map((b) => b.getAttribute("aria-valuenow"))).toEqual(["50", "0", "100"]);
  });

  it("Markup (ohne id/aria-labelledby) unverändert gegenüber vor dem Fix", () => {
    expect(markupWithoutA11yIds()).toMatchSnapshot();
  });
});
