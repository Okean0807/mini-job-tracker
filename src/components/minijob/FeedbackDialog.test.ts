/**
 * Feedback-Dialog (Einstellungen → Allgemein): echte Komponente, echter Store, nur sonner und
 * der Server-Aufruf (`submit`) sind Test-Doubles.
 */
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toastMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), message: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

import { tl } from "@/lib/i18n";
import { FeedbackError, MAX_FEEDBACK_CHARS, type FeedbackInput } from "@/lib/feedback/schema";
import { getData, replaceAll, saveJob, saveShift, updateSettings } from "@/lib/minijob/store";

import { FeedbackSection } from "./FeedbackDialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const de = (key: string, vars?: Record<string, string | number>) => tl("de", key, vars);

let host: HTMLDivElement;
let root: Root;
type Call = { data: FeedbackInput };
let submit: ReturnType<typeof vi.fn<(args: Call) => Promise<unknown>>>;

beforeEach(async () => {
  window.localStorage.clear();
  replaceAll({ shifts: [], jobs: [] });
  updateSettings({ language: "de" });
  toastMock.error.mockReset();
  toastMock.success.mockReset();
  submit = vi.fn(async () => ({ ok: true, duplicate: false }));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(createElement(FeedbackSection, { submit }));
  });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
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
const radio = (id: string) => $(`#${id}`);

describe("entry point and form", () => {
  it("the settings button is a labelled button that opens an accessible dialog", async () => {
    const button = $('[data-testid="feedback-open"]') as HTMLButtonElement;
    expect(button.tagName).toBe("BUTTON");
    expect(button.textContent).toContain(de("fb.open"));
    expect(button.getAttribute("aria-haspopup")).toBe("dialog");
    expect(dialog()).toBeNull();
    await open();
    expect(dialog()!.textContent).toContain(de("fb.dialog.title"));
  });

  it("offers bug, idea and rating; the star rating only for 'rating'", async () => {
    await open();
    expect(dialog()!.textContent).toContain(de("fb.kind.bug"));
    expect(dialog()!.textContent).toContain(de("fb.kind.idea"));
    expect(dialog()!.textContent).toContain(de("fb.kind.rating"));
    expect($('[data-testid="feedback-star-1"]')).toBeNull();
    await click(radio("fb-kind-rating"));
    expect($('[data-testid="feedback-star-5"]')).not.toBeNull();
    await click(radio("fb-kind-idea"));
    expect($('[data-testid="feedback-star-1"]')).toBeNull();
  });

  it("is accessible: labelled groups, labelled stars, described textarea, 44px targets", async () => {
    await open();
    await click(radio("fb-kind-rating"));
    expect(dialog()!.querySelector('[role="radiogroup"]')!.getAttribute("aria-label")).toBe(
      de("fb.kind.label"),
    );
    const star3 = $('[data-testid="feedback-star-3"]')!;
    expect(star3.getAttribute("role")).toBe("radio");
    expect(star3.getAttribute("aria-label")).toBe(de("fb.rating.star", { n: 3 }));
    expect(star3.className).toContain("size-11");
    const area = $("#fb-message")!;
    expect(document.querySelector('label[for="fb-message"]')).not.toBeNull();
    expect(area.getAttribute("aria-describedby")).toBe("fb-privacy fb-counter");
    expect(($("#fb-message") as HTMLTextAreaElement).maxLength).toBe(MAX_FEEDBACK_CHARS);
  });

  it("shows the privacy warning and a live character counter", async () => {
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

describe("client-side validation (the server validates again)", () => {
  it("a bug/idea without enough text is not sent", async () => {
    await open();
    await type("ab");
    await submitForm();
    expect(submit).not.toHaveBeenCalled();
    expect($('[data-testid="feedback-error"]')!.textContent).toBe(
      de("fb.error.messageRequired", { min: 3 }),
    );
    expect($('[data-testid="feedback-error"]')!.getAttribute("role")).toBe("alert");
  });

  it("a rating without stars is not sent; with stars it needs no text", async () => {
    await open();
    await click(radio("fb-kind-rating"));
    await submitForm();
    expect(submit).not.toHaveBeenCalled();
    expect($('[data-testid="feedback-error"]')!.textContent).toBe(de("fb.error.ratingRequired"));
    await click($('[data-testid="feedback-star-4"]'));
    await submitForm();
    await flush();
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0]![0].data).toMatchObject({ kind: "rating", rating: 4, message: "" });
  });
});

describe("sending", () => {
  it("success: toast only after the server confirmed, dialog closes, form resets", async () => {
    await open();
    await type("Der Export ist zu langsam");
    expect(toastMock.success).not.toHaveBeenCalled();
    await submitForm();
    await flush();
    expect(submit).toHaveBeenCalledTimes(1);
    expect(toastMock.success).toHaveBeenCalledWith(de("fb.success"));
    expect(toastMock.error).not.toHaveBeenCalled();
    expect(dialog()).toBeNull();
    await open();
    expect(($("#fb-message") as HTMLTextAreaElement).value).toBe("");
  });

  it("sends only the minimal fields — no app data from the store", async () => {
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
    expect(getData().shifts).toHaveLength(1);
    await open();
    await type("Kalender zeigt falsches Datum");
    await submitForm();
    await flush();
    const data = submit.mock.calls[0]![0].data;
    expect(Object.keys(data).sort()).toEqual(
      ["appVersion", "kind", "lang", "message", "route", "submissionId"].sort(),
    );
    const wire = JSON.stringify(submit.mock.calls);
    for (const secret of ["GEHEIMER-ARBEITGEBER", "GEHEIME-NOTIZ", "99.99", "2026-09-01"]) {
      expect(wire).not.toContain(secret);
    }
    expect(data.route).toMatch(/^\/[a-z0-9_\-/]*$/);
  });

  it("double click / repeated submit while sending sends exactly once and disables the button", async () => {
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

  it("network error: text kept, error shown (alert + toast), retry reuses the same submissionId", async () => {
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
    const ids = submit.mock.calls.map((c) => c[0].data.submissionId);
    expect(ids[0]).toBe(ids[1]);
    expect(toastMock.success).toHaveBeenCalledTimes(1);
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
    vi.restoreAllMocks();
  });

  it("the honeypot value travels to the server (which drops the submission)", async () => {
    await open();
    await type("Bot-Text");
    const trap = $('[data-testid="feedback-website"]') as HTMLInputElement;
    expect(trap.closest("[aria-hidden='true']")).not.toBeNull();
    expect(trap.tabIndex).toBe(-1);
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(trap, "http://spam");
      trap.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await submitForm();
    await flush();
    expect(submit.mock.calls[0]![0].data.website).toBe("http://spam");
  });

  it("works for guests: no sign-in or session is needed to send", async () => {
    await open();
    await type("Gast-Feedback");
    await submitForm();
    await flush();
    expect(submit).toHaveBeenCalledTimes(1);
    expect(toastMock.success).toHaveBeenCalled();
  });
});
