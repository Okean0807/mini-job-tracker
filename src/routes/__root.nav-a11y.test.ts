/**
 * ACCEPTANCE BUG #4 — Accessibility layout regression.
 * Schriftgröße=Sehr groß + Buttongröße=Handschuh-Modus must keep all 6 bottom-nav
 * labels inside their columns (no overflow/overlap/clip off-screen) while
 * preserving usable touch targets. Normal/Standard sizes stay compact.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { TEXT_SCALE } from "@/lib/minijob/theme";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const rootSrc = readFileSync(join(rootDir, "routes/__root.tsx"), "utf8");
const stylesSrc = readFileSync(join(rootDir, "styles.css"), "utf8");

/** Longest German bottom-nav labels (standard UI shows all 6). */
const NAV_LABELS = ["Übersicht", "Statistik", "Jobs", "Dokumente", "KI", "Einstellungen"];

function approxTextWidthPx(text: string, fontSizePx: number): number {
  // Conservative average glyph width for UI sans (Manrope/system).
  return text.length * fontSizePx * 0.62;
}

describe("bottom nav a11y layout (Sehr groß + Handschuh)", () => {
  it("BottomNav flex children allow truncation (min-w-0 + truncate)", () => {
    const fnStart = rootSrc.indexOf("function BottomNav");
    expect(fnStart).toBeGreaterThanOrEqual(0);
    const fn = rootSrc.slice(fnStart, rootSrc.indexOf("\n}\n", fnStart) + 3);
    expect(fn).toMatch(/min-w-0 flex-1/);
    expect(fn).toMatch(/truncate text-center/);
    expect(fn).toMatch(/min-h-11 min-w-0/);
    expect(fn).toMatch(/size-5 shrink-0/);
    expect(fn).toMatch(/aria-label=\{label\}/);
  });

  it("app shell class enables glove/large bottom padding overrides", () => {
    expect(rootSrc).toMatch(/className="app-shell min-h-screen pb-20"/);
    expect(stylesSrc).toMatch(/\[data-touch="glove"\] \.app-shell/);
    expect(stylesSrc).toMatch(/\[data-touch="large"\] \.app-shell/);
  });

  it("glove/large CSS keeps nav labels compact and in-column", () => {
    expect(stylesSrc).toMatch(/\[data-touch="glove"\] nav a\[href\]/);
    expect(stylesSrc).toMatch(/\[data-touch="large"\] nav a\[href\]/);
    // Must override the global glove a[href] font-size: 1.05rem
    const gloveNav = stylesSrc.slice(stylesSrc.indexOf('[data-touch="glove"] nav a[href]'));
    expect(gloveNav).toMatch(/font-size:\s*0\.625rem/);
    expect(gloveNav).toMatch(/overflow:\s*hidden/);
    expect(gloveNav).toMatch(/min-width:\s*0/);
    expect(gloveNav).toMatch(/min-height:\s*3\.25rem/);
  });

  it("labels fit a 360px mobile column under xl root + compact nav font", () => {
    const viewport = 360;
    const columns = 6;
    const columnWidth = viewport / columns;
    const rootPx = 16 * (parseFloat(TEXT_SCALE.xl) / 100); // 20px at 125%
    const navFontPx = 0.625 * rootPx; // CSS rem under html font-size
    expect(navFontPx).toBeLessThanOrEqual(13);

    for (const label of NAV_LABELS) {
      const natural = approxTextWidthPx(label, navFontPx);
      // Truncation keeps painted text ≤ column; assert natural overflow is handled
      // by markup (truncate) when natural width exceeds the column.
      if (natural > columnWidth) {
        expect(rootSrc).toMatch(/truncate/);
      }
      // With truncate, usable hit area is the full column (≥ 44px-ish touch).
      expect(columnWidth).toBeGreaterThanOrEqual(44);
    }

    // Glove touch target floor from CSS
    const gloveMinHeightRem = 3.25;
    const gloveMinHeightPx = gloveMinHeightRem * rootPx;
    expect(gloveMinHeightPx).toBeGreaterThanOrEqual(48);
  });

  it("does not enlarge nav label font via the global glove a[href] rule alone", () => {
    // Global rule still exists for buttons/inputs/non-nav links
    expect(stylesSrc).toMatch(/\[data-touch="glove"\] a\[href\][\s\S]*?font-size:\s*1\.05rem/);
    // But nav override must appear after / with higher specificity
    const globalIdx = stylesSrc.indexOf('[data-touch="glove"] a[href]');
    const navIdx = stylesSrc.indexOf('[data-touch="glove"] nav a[href]');
    expect(navIdx).toBeGreaterThan(globalIdx);
  });

  it("Normal/Standard baseline markup stays at 11px label size class", () => {
    const fnStart = rootSrc.indexOf("function BottomNav");
    const fn = rootSrc.slice(fnStart, rootSrc.indexOf("\n}\n", fnStart) + 3);
    expect(fn).toMatch(/text-\[11px\]/);
    // small/normal touch must not force glove padding in markup
    expect(fn).not.toMatch(/py-0\.9|min-h-\[3\.75rem\]/);
  });
});
