/**
 * B5 – wirft das Speichern selbst (nicht nur der Gerätespeicher), bleibt das Formular unverändert
 * offen, es wird nichts angelegt und der Fehler wird gemeldet. "Speichern" behält sein Verhalten.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const control = vi.hoisted(() => ({ fail: false }));

vi.mock("@/lib/minijob/service", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/minijob/service")>();
  return {
    ...original,
    persistDialogShift: (...args: Parameters<typeof original.persistDialogShift>) => {
      if (control.fail) throw new Error("boom");
      return original.persistDialogShift(...args);
    },
  };
});

const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", async (importOriginal) => {
  const original = await importOriginal<typeof import("sonner")>();
  return { ...original, toast: { ...original.toast, error: toastError } };
});

import { getData } from "@/lib/minijob/store";
import { click, closed, has, open, q, setValue, setup, teardown } from "./entry-test-harness";

beforeEach(() => {
  control.fail = false;
  toastError.mockClear();
  setup();
});
afterEach(teardown);

describe("B5 Speichern wirft", () => {
  it("Formular bleibt unverändert offen, nichts gespeichert, Fehler gemeldet", () => {
    open(null);
    setValue(q<HTMLInputElement>("#von"), "08:00");
    setValue(q<HTMLInputElement>("#bis"), "12:00");
    control.fail = true;
    click(q('[data-testid="entry-save-new"]'));
    expect(getData().shifts).toHaveLength(0);
    expect(closed.count).toBe(0);
    expect(has('[data-testid="entry-save"]')).toBe(true);
    expect(q<HTMLInputElement>("#von").value).toBe("08:00");
    expect(q<HTMLInputElement>("#bis").value).toBe("12:00");
    expect(toastError).toHaveBeenCalledTimes(1);

    control.fail = false;
    click(q('[data-testid="entry-save-new"]'));
    expect(getData().shifts).toHaveLength(1);
    expect(q<HTMLInputElement>("#bis").value).toBe("");
  });
});
