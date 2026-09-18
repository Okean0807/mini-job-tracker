import { beforeEach, describe, expect, it } from "vitest";

import { isValidPin, PIN_MAX_LENGTH, PIN_MIN_LENGTH, validatePinConfirm, withConsistentPinSettings } from "./pin";
import { getData, normalize, replaceAll, updateSettings } from "./store";
import { DEFAULT_SETTINGS } from "./types";

describe("isValidPin", () => {
  it("rejects empty/missing PIN", () => {
    expect(isValidPin(undefined)).toBe(false);
    expect(isValidPin(null)).toBe(false);
    expect(isValidPin("")).toBe(false);
  });

  it("rejects too short, too long, or non-digit PINs", () => {
    expect(isValidPin("123")).toBe(false);
    expect(isValidPin("123456789")).toBe(false);
    expect(isValidPin("12ab")).toBe(false);
    expect(isValidPin(" 1234")).toBe(false);
  });

  it("accepts 4–8 digit PINs", () => {
    expect(PIN_MIN_LENGTH).toBe(4);
    expect(PIN_MAX_LENGTH).toBe(8);
    expect(isValidPin("1234")).toBe(true);
    expect(isValidPin("12345678")).toBe(true);
  });
});

describe("withConsistentPinSettings", () => {
  it("forces pinEnabled false when PIN is missing/invalid", () => {
    expect(withConsistentPinSettings({ pinEnabled: true })).toEqual({ pinEnabled: false });
    expect(withConsistentPinSettings({ pinEnabled: true, pin: "" })).toEqual({
      pinEnabled: false,
      pin: "",
    });
    expect(withConsistentPinSettings({ pinEnabled: true, pin: "12" })).toEqual({
      pinEnabled: false,
      pin: "12",
    });
  });

  it("keeps pinEnabled when PIN is valid", () => {
    expect(withConsistentPinSettings({ pinEnabled: true, pin: "4242" })).toEqual({
      pinEnabled: true,
      pin: "4242",
    });
  });
});

describe("updateSettings pinEnabled gate", () => {
  beforeEach(() => {
    replaceAll({
      shifts: [],
      jobs: [],
      settings: { ...DEFAULT_SETTINGS },
    });
  });

  it("cannot enable pinEnabled with empty/missing pin", () => {
    updateSettings({ pinEnabled: true });
    expect(getData().settings.pinEnabled).toBe(false);
    expect(getData().settings.pin).toBeUndefined();

    updateSettings({ pinEnabled: true, pin: "" });
    expect(getData().settings.pinEnabled).toBe(false);
  });

  it("enables pinEnabled together with a valid pin", () => {
    updateSettings({ pin: "1357", pinEnabled: true });
    expect(getData().settings.pinEnabled).toBe(true);
    expect(getData().settings.pin).toBe("1357");
  });

  it("disables pinEnabled if pin later becomes invalid", () => {
    updateSettings({ pin: "1357", pinEnabled: true });
    updateSettings({ pin: "1" });
    expect(getData().settings.pinEnabled).toBe(false);
    expect(getData().settings.pin).toBe("1");
  });
});

describe("normalize pinEnabled gate", () => {
  it("coerces persisted pinEnabled true without pin to false", () => {
    const data = normalize({
      settings: { ...DEFAULT_SETTINGS, pinEnabled: true },
    });
    expect(data.settings.pinEnabled).toBe(false);
  });

  it("keeps pinEnabled when a valid pin is present", () => {
    const data = normalize({
      settings: { ...DEFAULT_SETTINGS, pinEnabled: true, pin: "9999" },
    });
    expect(data.settings.pinEnabled).toBe(true);
    expect(data.settings.pin).toBe("9999");
  });
});


describe("validatePinConfirm (Batch F setup UX)", () => {
  it("accepts matching valid PIN + confirm", () => {
    expect(validatePinConfirm("1357", "1357")).toEqual({ ok: true, pin: "1357" });
  });

  it("errors short / mismatch / invalid / cancel", () => {
    expect(validatePinConfirm("12", "12")).toEqual({ ok: false, error: "short" });
    expect(validatePinConfirm("1357", "1358")).toEqual({ ok: false, error: "mismatch" });
    expect(validatePinConfirm("12ab", "12ab")).toEqual({ ok: false, error: "invalid" });
    expect(validatePinConfirm("1357", "1357", { cancel: true })).toEqual({
      ok: false,
      error: "cancel",
    });
  });
});
