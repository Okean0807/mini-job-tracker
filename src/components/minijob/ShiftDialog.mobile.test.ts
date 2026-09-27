import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "ShiftDialog.tsx"), "utf8");

describe("entry editor mobile shell", () => {
  it("keeps a sticky header and a bottom action bar with Speichern as primary", () => {
    expect(src).toMatch(/data-testid="entry-header"/);
    expect(src).toMatch(/data-testid="entry-editor-scroll"/);
    expect(src).toMatch(/data-testid="entry-save"/);
    expect(src).toMatch(/env\(safe-area-inset-bottom\)/);
    expect(src).toMatch(/env\(safe-area-inset-top\)/);
  });

  it("puts Löschen in the scroll area, never next to Speichern", () => {
    const deleteIndex = src.indexOf('data-testid="entry-delete"');
    const saveIndex = src.indexOf('data-testid="entry-save"');
    expect(deleteIndex).toBeGreaterThan(-1);
    expect(deleteIndex).toBeLessThan(saveIndex);
    const footer = src.slice(src.lastIndexOf("action.cancel") - 400, saveIndex + 200);
    expect(footer).not.toMatch(/entry-delete/);
  });

  it("scrolls the focused field into view so the keyboard cannot cover it", () => {
    expect(src).toMatch(/function keepFieldVisible/);
    expect(src).toMatch(/scrollIntoView\(\{ block: "center"/);
  });
});

describe("entry editor context by kind", () => {
  it("only renders work sections for Arbeit", () => {
    expect(src).toMatch(/const isWork = kind === "arbeit"/);
    expect(src).toMatch(/data-work=\{isWork \? "1" : "0"\}/);
    expect(src).toMatch(/\{!isWork \? <section>\{noteField\}<\/section> : null\}/);
  });
});

describe("entry editor German formats", () => {
  it("shows hours and minutes instead of decimal hours", () => {
    expect(src).toMatch(/formatWorkDuration/);
    expect(src).toMatch(/entry\.hoursShort/);
    expect(src).toMatch(/entry\.minutesShort/);
    expect(src).not.toMatch(/formatHours\(/);
  });

  it("uses a German decimal rate field with a € suffix", () => {
    expect(src).toMatch(/sanitizeRateInput/);
    expect(src).toMatch(/formatRateInput/);
    expect(src).not.toMatch(/id="lohn"\s+type="number"/);
  });
});

describe("entry editor object states", () => {
  it("offers only the actions that fit the current state", () => {
    expect(src).toMatch(/data-object=\{hasObjectData \? "set" : "empty"\}/);
    expect(src).toMatch(/selectedObject \? \(\s*<Button[\s\S]*?data-testid="object-edit"/);
    expect(src).toMatch(/data-testid="object-create"/);
    expect(src).toMatch(/openObjectDialog\(selectedObject\)/);
    expect(src).toMatch(/object=\{objectDialogTarget\}/);
  });

  it("shows the entry's own address, so editing an object cannot rewrite history", () => {
    expect(src).toMatch(/const objectAddressLines = \[/);
    expect(src).toMatch(/placeLine === objectTitle \? "" : placeLine/);
  });
});

describe("entry editor selection placeholders", () => {
  it("asks for a Leistungsart instead of showing an empty option as the value", () => {
    expect(src).toMatch(/entry\.chooseWorkCode/);
    expect(src).toMatch(/selectedWork \? t\("worklog\.none"\) : t\("entry\.chooseWorkCode"\)/);
  });

  it("asks for a Tätigkeit and keeps saved tasks out of the suggestion row", () => {
    expect(src).toMatch(/entry\.addTask/);
    expect(src).toMatch(/customTasksCatalog\.filter\(\(label\) => !tasks\.includes\(label\)\)/);
  });
});

describe("entry editor optional block", () => {
  it("summarises what is already stored behind Weitere Angaben", () => {
    expect(src).toMatch(/data-testid="entry-more-summary"/);
    expect(src).toMatch(/extrasSummaryParts/);
    expect(src).toMatch(/entry\.photoCount/);
    expect(src).toMatch(/entry\.gpsSaved/);
    expect(src).toMatch(/entry\.noteSaved/);
  });
});

describe("entry editor accessibility", () => {
  it("labels the overlay selects and the icon-only controls", () => {
    expect(src).toMatch(/htmlFor="objekt-auswahl"/);
    expect(src).toMatch(/htmlFor="leistungsart-auswahl"/);
    expect(src).toMatch(/htmlFor="taetigkeit-auswahl"/);
    expect(src).toMatch(/aria-label=\{t\("action\.back"\)\}/);
    expect(src).toMatch(/aria-label=\{t\("label\.date"\)\}/);
    expect(src).toMatch(/aria-pressed=\{kind === k\}/);
  });

  it("does not shrink labels below readable size", () => {
    expect(src).not.toMatch(/text-\[11px\]/);
    expect(src).not.toMatch(/text-\[10px\]/);
  });
});
