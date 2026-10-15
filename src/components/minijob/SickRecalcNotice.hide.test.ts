/**
 * DECISIONS R3 Punkt 4: Hinweis je Bildschirm ausblendbar, ohne Bestätigungen
 * zu ändern; erscheint wieder, sobald sich die Vorschau ändert (z. B. nach
 * Import/Ersetzen). Prüfhinweis je Monat (reviewDays).
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { tl } from "@/lib/i18n";
import type { SickRecalcMonth } from "@/lib/minijob/payroll";
import type { Shift } from "@/lib/minijob/types";

let preview: SickRecalcMonth[] = [];
vi.mock("@/lib/minijob/payroll", async (orig) => ({
  ...(await orig<typeof import("@/lib/minijob/payroll")>()),
  sickRecalcPreview: () => preview,
}));

const { SickRecalcNotice } = await import("./SickRecalcNotice");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
const q = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const onConfirm = vi.fn();
function render(shifts: Shift[]) {
  act(() =>
    root.render(createElement(SickRecalcNotice, { shifts, resolve: () => ({}), onConfirm })),
  );
}

describe("SickRecalcNotice ausblenden / Prüfhinweis", () => {
  it("Ausblenden versteckt nur die Anzeige; neue Vorschau zeigt ihn wieder", () => {
    preview = [{ month: "2026-12", days: 18, before: 2325, after: 975, reviewDays: 0 }];
    const a: Shift[] = [];
    render(a);
    expect(q("sick-recalc-hide")?.textContent).toBe(tl("de", "sickRecalc.hide"));
    act(() => q("sick-recalc-hide")!.click());
    expect(q("sick-recalc-notice")).toBeNull();
    expect(onConfirm).not.toHaveBeenCalled();
    render([]); // gleiche Vorschau (neuer Array-Bezug) → bleibt ausgeblendet
    expect(q("sick-recalc-notice")).toBeNull();
    preview = [{ month: "2026-12", days: 19, before: 2400, after: 975, reviewDays: 0 }];
    render([]);
    expect(q("sick-recalc-notice")).not.toBeNull();
  });

  it("reviewDays > 0 → Prüfhinweis am Monat", () => {
    preview = [
      { month: "2026-12", days: 3, before: 225, after: 75, reviewDays: 2 },
      { month: "2027-01", days: 1, before: 75, after: 0, reviewDays: 0 },
    ];
    render([]);
    act(() => q("sick-recalc-review")!.click());
    const hints = container.querySelectorAll('[data-testid="sick-recalc-review-days"]');
    expect(hints).toHaveLength(1);
    expect(hints[0]!.textContent).toBe(tl("de", "sickRecalc.reviewDays", { count: 2 }));
  });
});
