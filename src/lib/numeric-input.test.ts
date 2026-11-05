import { describe, expect, it } from "vitest";

import { formatNumericValue, MAX_NUMERIC_INPUT, parseNumericDraft } from "./numeric-input";

describe("parseNumericDraft", () => {
  it.each([
    ["0", 0],
    ["8", 8],
    ["08", 8],
    ["80", 80],
    ["080", 80],
    ["0080", 80],
    ["100", 100],
    ["250", 250],
    ["12.5", 12.5],
    ["12,5", 12.5],
    [" 80 ", 80],
    [".5", 0.5],
    ["1e2", 100],
  ])("accepts %j -> %d", (raw, expected) => {
    expect(parseNumericDraft(raw)).toBe(expected);
  });

  it.each(["", " ", "-", "+", ".", "abc", "8a", "1,2,3", "1e", "--5", "NaN", "Infinity", "1e999"])(
    "rejects %j (never becomes 0)",
    (raw) => {
      expect(parseNumericDraft(raw)).toBeNull();
    },
  );

  it("rejects negatives by default, honours a custom minimum", () => {
    expect(parseNumericDraft("-5")).toBeNull();
    expect(parseNumericDraft("-0.1")).toBeNull();
    expect(parseNumericDraft("-5", -10)).toBe(-5);
    expect(parseNumericDraft("5", 10)).toBeNull();
  });

  it("never returns -0 (stored data must not contain -0)", () => {
    expect(Object.is(parseNumericDraft("-0")!, 0)).toBe(true);
    expect(Object.is(parseNumericDraft("-0.0")!, 0)).toBe(true);
  });

  it("has no 100 % cap but a finite technical bound", () => {
    expect(parseNumericDraft("100000")).toBe(100000);
    expect(parseNumericDraft(String(MAX_NUMERIC_INPUT))).toBe(MAX_NUMERIC_INPUT);
    expect(parseNumericDraft(String(MAX_NUMERIC_INPUT) + "0")).toBeNull();
  });
});

describe("formatNumericValue", () => {
  it("renders canonical numbers without leading zeros", () => {
    expect(formatNumericValue(80)).toBe("80");
    expect(formatNumericValue(0)).toBe("0");
    expect(formatNumericValue(-0)).toBe("0");
    expect(formatNumericValue(12.5)).toBe("12.5");
    expect(formatNumericValue(Number.NaN)).toBe("0");
  });
});
