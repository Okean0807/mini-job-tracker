import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "TodayImportantCard.tsx"), "utf8");

describe("TodayImportantCard mobile/a11y hardening", () => {
  it("keeps the heading block shrinkable inside the card", () => {
    expect(src).toMatch(/flex min-w-0 items-start justify-between gap-3/);
    expect(src).toMatch(/<div className="min-w-0">/);
  });

  it("allows long wage-warning text to wrap instead of forcing horizontal overflow", () => {
    expect(src).toMatch(/min-w-0 rounded-xl border border-destructive\/30/);
    expect(src).toMatch(/break-words hover:bg-muted\/10|break-words hover:bg-destructive\/10/);
  });

  it("keeps the primary action at a mobile touch-target height", () => {
    expect(src).toMatch(/min-h-11 w-full/);
  });

  it("keeps the card semantically labelled for assistive technology", () => {
    expect(src).toMatch(/aria-labelledby="today-important-title"/);
    expect(src).toMatch(/id="today-important-title"/);
  });
});
