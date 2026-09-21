import { describe, expect, it } from "vitest";

import {
  extrasSummaryParts,
  formatRateInput,
  formatWorkDuration,
  sanitizeRateInput,
  splitHoursMinutes,
} from "./entry-format";

const de = { hour: "Std.", minute: "Min." };

describe("formatWorkDuration", () => {
  it("writes German hours and minutes instead of decimal hours", () => {
    expect(formatWorkDuration(7.5, de)).toBe("7 Std. 30 Min.");
    expect(formatWorkDuration(8, de)).toBe("8 Std.");
    expect(formatWorkDuration(0.75, de)).toBe("45 Min.");
    expect(formatWorkDuration(0, de)).toBe("0 Min.");
  });

  it("rounds to whole minutes and never goes negative", () => {
    expect(splitHoursMinutes(1.0049)).toEqual({ hours: 1, minutes: 0 });
    expect(formatWorkDuration(-3, de)).toBe("0 Min.");
    expect(formatWorkDuration(Number.NaN, de)).toBe("0 Min.");
  });
});

describe("rate input", () => {
  it("shows the German decimal comma with two digits", () => {
    expect(formatRateInput(13.5)).toBe("13,50");
    expect(formatRateInput(15)).toBe("15,00");
    expect(formatRateInput(0)).toBe("0,00");
    expect(formatRateInput(undefined)).toBe("");
  });

  it("keeps typing usable: comma or dot, max two decimals", () => {
    expect(sanitizeRateInput("13.5")).toBe("13,5");
    expect(sanitizeRateInput("13,50")).toBe("13,50");
    expect(sanitizeRateInput("13,507")).toBe("13,50");
    expect(sanitizeRateInput("1a3€")).toBe("13");
    expect(sanitizeRateInput("")).toBe("");
  });
});

describe("extrasSummaryParts", () => {
  const labels = {
    photos: (n: number) => `Fotos ${n}`,
    gps: "Standort gespeichert",
    note: "Notiz vorhanden",
    overtime: "Überstunden",
  };

  it("summarises only what the shift actually has", () => {
    expect(
      extrasSummaryParts({ photos: 2, gps: true, note: true, overtime: false }, labels),
    ).toEqual(["Fotos 2", "Standort gespeichert", "Notiz vorhanden"]);
    expect(extrasSummaryParts({ photos: 0, gps: false, note: false, overtime: true }, labels)).toEqual([
      "Überstunden",
    ]);
    expect(extrasSummaryParts({ photos: 0, gps: false, note: false, overtime: false }, labels)).toEqual(
      [],
    );
  });
});
