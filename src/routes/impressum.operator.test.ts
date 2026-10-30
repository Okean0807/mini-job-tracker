/**
 * The Impressum shows exactly the operator data released by the operator and nothing invented:
 * no placeholder, no phone number, no register/tax/trade details. Source-level guard.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "impressum.tsx"), "utf8");

describe("/impressum operator data", () => {
  it("shows name, address and the two contact channels", () => {
    expect(src).toMatch(/Juri Vollmer/);
    expect(src).toMatch(/Blumhardtstr\. 23/);
    expect(src).toMatch(/30625 Hannover/);
    expect(src).toMatch(/Deutschland/);
    expect(src).toMatch(/href="mailto:jurivollmer84@gmail\.com"/);
    expect(src).toMatch(/href="https:\/\/t\.me\/Juri_Vollmer"/);
    expect(src).toMatch(/@Juri_Vollmer/);
  });

  it("marks Telegram as an additional channel, not as the only one", () => {
    expect(src).toMatch(/Telegram \(weiterer Kontaktweg\)/);
    expect(src).toMatch(/E-Mail:/);
  });

  it("opens the external Telegram link safely", () => {
    expect(src).toMatch(/target="_blank"/);
    expect(src).toMatch(/rel="noopener noreferrer"/);
  });

  it("has no placeholder text left", () => {
    expect(src).not.toMatch(/Noch nicht veröffentlicht|Platzhalter|\[\[|AUSFÜLLEN|ENTSCHEIDUNG/);
  });

  it("states no phone number and no invented company details", () => {
    expect(src).not.toMatch(/\+?\d{2,4}[\s/-]?\d{3,}[\s/-]?\d{3,}/);
    expect(src).not.toMatch(
      /Telefon|Handelsregister|HRB|Umsatzsteuer|USt-?Id|Gewerbe|GmbH|UG\b|e\.\s?K\.|Kleinunternehmer|Aufsichtsbehörde|Berufsbezeichnung/i,
    );
  });

  it("keeps the links to the other legal pages", () => {
    expect(src).toMatch(/to="\/datenschutz"/);
    expect(src).toMatch(/to="\/ki-hinweise"/);
  });
});
