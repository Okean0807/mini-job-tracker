/**
 * Progress (shadcn/Radix): `value` wird als aria-valuenow an Radix Root
 * weitergereicht; ungültige Werte werden nur für ARIA begrenzt, der Indikator
 * bleibt exakt wie zuvor. react-dom/client + act, happy-dom (keine neue Dependency).
 */
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Progress } from "./progress";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let errorSpy: ReturnType<typeof vi.spyOn>;

function render(props: Record<string, unknown>) {
  act(() => {
    root.render(createElement(Progress, props));
  });
  const bar = container.querySelector<HTMLElement>('[role="progressbar"]')!;
  const indicator = bar.firstElementChild as HTMLElement;
  return { bar, indicator };
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  errorSpy.mockRestore();
});

describe("Progress aria-valuenow", () => {
  it.each([
    [0, "0", "loading", "translateX(-100%)"],
    [50, "50", "loading", "translateX(-50%)"],
    [100, "100", "complete", "translateX(-0%)"],
  ])("value %s → aria-valuenow %s", (value, now, state, transform) => {
    const { bar, indicator } = render({ value, max: 100 });
    expect(bar.getAttribute("aria-valuenow")).toBe(now);
    expect(bar.getAttribute("aria-valuemin")).toBe("0");
    expect(bar.getAttribute("aria-valuemax")).toBe("100");
    expect(bar.getAttribute("data-state")).toBe(state);
    expect(indicator.style.transform).toBe(transform);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("ohne max: Radix-Default 100, Wert wird gesetzt", () => {
    const { bar } = render({ value: 42 });
    expect(bar.getAttribute("aria-valuenow")).toBe("42");
    expect(bar.getAttribute("aria-valuemax")).toBe("100");
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("über max: ARIA auf max begrenzt, Indikator unverändert wie zuvor", () => {
    const { bar, indicator } = render({ value: 150, max: 100 });
    expect(bar.getAttribute("aria-valuenow")).toBe("100");
    expect(indicator.style.transform).toBe("translateX(--50%)");
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("negativ: ARIA auf 0 begrenzt", () => {
    const { bar } = render({ value: -5, max: 100 });
    expect(bar.getAttribute("aria-valuenow")).toBe("0");
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it.each([[Number.NaN], [Number.POSITIVE_INFINITY], [undefined], [null]])(
    "ungültig (%s): kein aria-valuenow, indeterminate, kein Radix-Fehler, Indikator wie zuvor",
    (value) => {
      const { bar, indicator } = render({ value, max: 100 });
      expect(bar.hasAttribute("aria-valuenow")).toBe(false);
      expect(bar.getAttribute("data-state")).toBe("indeterminate");
      const expected = `translateX(-${100 - ((value as number) || 0)}%)`;
      expect(indicator.style.transform).toBe(expected);
      expect(errorSpy).not.toHaveBeenCalled();
    },
  );

  it("eigenes max wird respektiert und weitergereicht", () => {
    const { bar } = render({ value: 150, max: 200 });
    expect(bar.getAttribute("aria-valuenow")).toBe("150");
    expect(bar.getAttribute("aria-valuemax")).toBe("200");
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("className, weitere Props und ref bleiben erhalten", () => {
    const ref = createRef<HTMLDivElement>();
    const { bar } = render({ value: 10, className: "mt-1.5 h-2.5", "aria-labelledby": "x y", ref });
    expect(bar.className).toBe(
      "relative w-full overflow-hidden rounded-full bg-primary/20 mt-1.5 h-2.5",
    );
    expect(bar.getAttribute("aria-labelledby")).toBe("x y");
    expect(ref.current).toBe(bar);
  });
});
