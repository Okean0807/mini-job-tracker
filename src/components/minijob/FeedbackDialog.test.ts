/**
 * Feedback window (Einstellungen → Allgemein): real component, real store; only sonner, the auth hook and
 * the server call (`submit`) are test doubles.
 */
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toastMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), message: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));
const authState = vi.hoisted(() => ({
  status: "signed_in" as "loading" | "signed_in" | "signed_out",
}));
vi.mock("@/hooks/use-auth-session", () => ({
  useAuthSession: () => ({ status: authState.status, session: null }),
}));

import { tl } from "@/lib/i18n";
import { FeedbackError, MAX_FEEDBACK_CHARS, type FeedbackInput } from "@/lib/feedback/schema";
import { replaceAll, saveJob, saveShift, updateSettings } from "@/lib/minijob/store";

import { FeedbackSection } from "./FeedbackDialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const de = (key: string, vars?: Record<string, string | number>) => tl("de", key, vars);

let host: HTMLDivElement;
let root: Root;
type Call = { data: FeedbackInput };
let submit: ReturnType<typeof vi.fn<(args: Call) => Promise<unknown>>>;
let openAccount: ReturnType<typeof vi.fn<() => void>>;

const renderSection = () =>
  act(async () => {
    root.render(createElement(FeedbackSection, { submit, onOpenAccount: openAccount }));
  });

beforeEach(async () => {
  authState.status = "signed_in";
  openAccount = vi.fn<() => void>();
  window.localStorage.clear();
  replaceAll({ shifts: [], jobs: [] });
  updateSettings({ language: "de" });
  toastMock.error.mockReset();
  toastMock.success.mockReset();
  submit = vi.fn(async () => ({ ok: true, duplicate: false }));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await renderSection();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

const $ = (sel: string) => document.body.querySelector<HTMLElement>(sel);
const dialog = () => $('[role="dialog"]');
const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 20))));
const click = (el: HTMLElement | null) => act(async () => el!.click());
const open = () => click($('[data-testid="feedback-open"]'));
async function type(text: string) {
  const area = $("#fb-message") as HTMLTextAreaElement;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    setter.call(area, text);
    area.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const submitForm = () =>
  act(async () => {
    $('[data-testid="feedback-form"]')!.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });

describe("the window", () => {
  it("a labelled button in the settings opens a dialog with a message field, a counter and a send button", async () => {
    const button = $('[data-testid="feedback-open"]') as HTMLButtonElement;
    expect(button.tagName).toBe("BUTTON");
    expect(button.textContent).toContain(de("fb.open"));
    expect(button.getAttribute("aria-haspopup")).toBe("dialog");
    expect(dialog()).toBeNull();
    await open();
    expect(dialog()!.textContent).toContain(de("fb.dialog.title"));
    expect($("#fb-message")).not.toBeNull();
    expect($('[data-testid="feedback-submit"]')!.textContent).toBe(de("fb.send"));
  });

  it("is simple: one message field, no type or rating controls, nothing else to fill in", async () => {
    await open();
    expect(dialog()!.querySelectorAll("textarea")).toHaveLength(1);
    expect(dialog()!.querySelectorAll("input")).toHaveLength(0);
    expect(dialog()!.querySelector('[role="radiogroup"], [role="radio"]')).toBeNull();
  });

  it("is accessible and touch friendly: labelled field, described by hint and counter, 44px buttons, 2000 limit", async () => {
    await open();
    const area = $("#fb-message") as HTMLTextAreaElement;
    expect(document.querySelector('label[for="fb-message"]')).not.toBeNull();
    expect(area.getAttribute("aria-describedby")).toBe("fb-privacy fb-counter");
    expect(area.maxLength).toBe(MAX_FEEDBACK_CHARS);
    const formButtons = $('[data-testid="feedback-form"]')!.querySelectorAll("button");
    expect(formButtons).toHaveLength(2); // Abbrechen + Absenden
    for (const b of formButtons) expect(b.className, b.textContent ?? "").toContain("min-h-11");
    expect($('[data-testid="feedback-open"]')!.className).toContain("min-h-11");
  });

  it("shows the privacy hint (no salaries/shifts, reply address is sent) and a live counter", async () => {
    await open();
    expect($('[data-testid="feedback-privacy"]')!.textContent).toBe(de("fb.privacy"));
    expect($('[data-testid="feedback-counter"]')!.textContent).toBe(
      de("fb.counter", { count: 0, max: 2000 }),
    );
    await type("Hallo");
    expect($('[data-testid="feedback-counter"]')!.textContent).toBe(
      de("fb.counter", { count: 5, max: 2000 }),
    );
  });
});

describe("validation in the form (the server validates again)", () => {
  it.each(["", "  ", "ab"])("an empty or too short message (%j) is not sent", async (text) => {
    await open();
    await type(text);
    await submitForm();
    expect(submit).not.toHaveBeenCalled();
    expect($('[data-testid="feedback-error"]')!.textContent).toBe(
      de("fb.error.messageRequired", { min: 3 }),
    );
    expect($('[data-testid="feedback-error"]')!.getAttribute("role")).toBe("alert");
  });

  it("the field cannot exceed the limit", async () => {
    await open();
    expect(($("#fb-message") as HTMLTextAreaElement).maxLength).toBe(2000);
  });
});

describe("sending", () => {
  it("sends only the message and four automatic technical fields; success is shown after the server confirmed", async () => {
    saveJob({
      id: "j1",
      name: "GEHEIMER-ARBEITGEBER",
      color: "#000000",
      mode: "flex",
      rate: 99.99,
    });
    saveShift({
      id: "s1",
      jobId: "j1",
      kind: "arbeit",
      date: "2026-09-01",
      start: "09:00",
      end: "17:00",
      breakMinutes: 0,
      note: "GEHEIME-NOTIZ",
    });
    await open();
    await type("Der Kalender zeigt das falsche Datum");
    expect(toastMock.success).not.toHaveBeenCalled();
    await submitForm();
    await flush();
    expect(submit).toHaveBeenCalledTimes(1);
    const data = submit.mock.calls[0]![0].data;
    expect(Object.keys(data).sort()).toEqual([
      "appVersion",
      "lang",
      "message",
      "route",
      "submissionId",
    ]);
    expect(data.message).toBe("Der Kalender zeigt das falsche Datum");
    const wire = JSON.stringify(submit.mock.calls);
    for (const secret of ["GEHEIMER-ARBEITGEBER", "GEHEIME-NOTIZ", "99.99", "2026-09-01", "@"]) {
      expect(wire).not.toContain(secret);
    }
    expect(toastMock.success).toHaveBeenCalledWith(de("fb.success"));
    expect(toastMock.error).not.toHaveBeenCalled();
    expect(dialog()).toBeNull();
    await open();
    expect(($("#fb-message") as HTMLTextAreaElement).value).toBe(""); // form reset after success
  });

  it("shows a sending indicator, locks the button and sends once on repeated clicks", async () => {
    let release!: (v: unknown) => void;
    submit.mockImplementation(() => new Promise((r) => (release = r)));
    await open();
    await type("Doppelklick-Test");
    await submitForm();
    await submitForm();
    await submitForm();
    expect(submit).toHaveBeenCalledTimes(1);
    const button = $('[data-testid="feedback-submit"]') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.textContent).toBe(de("fb.sending"));
    await act(async () => release({ ok: true, duplicate: false }));
    await flush();
    expect(toastMock.success).toHaveBeenCalledTimes(1);
  });

  it("network error: text kept, clear error (alert + toast), retry uses the same form id", async () => {
    submit.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await open();
    await type("Absturz beim Speichern");
    await submitForm();
    await flush();
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(toastMock.error).toHaveBeenCalledWith(de("fb.error.network"));
    expect($('[data-testid="feedback-error"]')!.textContent).toBe(de("fb.error.network"));
    expect(($("#fb-message") as HTMLTextAreaElement).value).toBe("Absturz beim Speichern");
    expect(($('[data-testid="feedback-submit"]') as HTMLButtonElement).disabled).toBe(false);
    await submitForm();
    await flush();
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[0]![0].data.submissionId).toBe(
      submit.mock.calls[1]![0].data.submissionId,
    );
    expect(toastMock.success).toHaveBeenCalledTimes(1);
  });

  it("editing the text after a failed attempt starts a new form id (same id + new text would be a provider conflict)", async () => {
    submit.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await open();
    await type("Erste Fassung");
    await submitForm();
    await flush();
    await type("Zweite Fassung, ergänzt");
    await submitForm();
    await flush();
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[0]![0].data.submissionId).not.toBe(
      submit.mock.calls[1]![0].data.submissionId,
    );
  });

  it("a mail-service failure (server says unavailable) is an error, never a success", async () => {
    submit.mockRejectedValueOnce(new FeedbackError("unavailable"));
    await open();
    await type("Mail-Dienst ausgefallen");
    await submitForm();
    await flush();
    expect(toastMock.success).not.toHaveBeenCalled();
    expect($('[data-testid="feedback-error"]')!.textContent).toBe(de("fb.error.network"));
  });

  it("an unconfirmed server answer is never shown as success", async () => {
    submit.mockResolvedValueOnce({ ok: false });
    await open();
    await type("Unbestätigt");
    await submitForm();
    await flush();
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(toastMock.error).toHaveBeenCalledWith(de("fb.error.network"));
  });

  it("rate limit: friendly minutes message, text kept", async () => {
    submit.mockRejectedValueOnce(new FeedbackError("rate_limited", 600));
    await open();
    await type("Zu oft gesendet");
    await submitForm();
    await flush();
    expect($('[data-testid="feedback-error"]')!.textContent).toBe(
      de("fb.error.rate", { minutes: 10 }),
    );
    expect(($("#fb-message") as HTMLTextAreaElement).value).toBe("Zu oft gesendet");
  });

  it("offline: clear message, nothing sent", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    await open();
    await type("Offline-Test");
    await submitForm();
    await flush();
    expect(submit).not.toHaveBeenCalled();
    expect($('[data-testid="feedback-error"]')!.textContent).toBe(de("fb.error.offline"));
  });
});

describe("only for signed-in users", () => {
  const rerender = async (status: "loading" | "signed_in" | "signed_out") => {
    authState.status = status;
    await renderSection();
  };

  it("while the auth state is loading: no sign-in prompt, the button is locked, nothing opens", async () => {
    await rerender("loading");
    expect($('[data-testid="feedback-signin"]')).toBeNull();
    const button = $('[data-testid="feedback-open"]') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
    await click(button);
    expect(dialog()).toBeNull();
  });

  it("guest: sees the sign-in suggestion, no message button, no dialog, nothing is sent", async () => {
    await rerender("signed_out");
    expect($('[data-testid="feedback-signin"]')!.textContent).toContain(de("fb.signIn.required"));
    expect($('[data-testid="feedback-open"]')).toBeNull();
    expect(dialog()).toBeNull();
    expect(submit).not.toHaveBeenCalled();
  });

  it("the sign-in button takes the guest to the account tab", async () => {
    await rerender("signed_out");
    await click($('[data-testid="feedback-signin-action"]'));
    expect(openAccount).toHaveBeenCalledTimes(1);
  });

  it("signing out while the dialog is open closes it and nothing can be submitted", async () => {
    await open();
    await type("Text vor dem Abmelden");
    await rerender("signed_out");
    expect(dialog()).toBeNull();
    expect(submit).not.toHaveBeenCalled();
  });

  it("an expired session answered by the server shows the sign-in-again message and keeps the text", async () => {
    submit.mockRejectedValueOnce(new Error("Unauthorized: Invalid token"));
    await open();
    await type("Sitzung abgelaufen");
    await submitForm();
    await flush();
    expect($('[data-testid="feedback-error"]')!.textContent).toBe(de("fb.error.unauthenticated"));
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(($("#fb-message") as HTMLTextAreaElement).value).toBe("Sitzung abgelaufen");
  });

  it("an anonymous Supabase session is told feedback is unavailable", async () => {
    submit.mockRejectedValueOnce(new FeedbackError("forbidden"));
    await open();
    await type("Anonym");
    await submitForm();
    await flush();
    expect($('[data-testid="feedback-error"]')!.textContent).toBe(de("fb.error.forbidden"));
  });
});
