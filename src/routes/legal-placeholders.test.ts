/**
 * v1.0 (t617u, Legal): Impressum und Datenschutz sind noch nicht final. Die
 * Seiten dürfen keine erfundenen Anbieterangaben enthalten und müssen den
 * Vorab-Status sichtbar ausweisen (statische Quelltext-Prüfung, kein Render).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), "utf8");

describe("Legal-Seiten: Vorab-Status sichtbar, keine erfundenen Angaben", () => {
  it("Impressum weist 'Noch nicht veröffentlicht' aus und enthält keine Anschrift/Registerdaten", () => {
    const src = read("impressum.tsx");
    expect(src).toContain("Noch nicht veröffentlicht");
    expect(src).not.toMatch(/\b\d{5}\s+[A-ZÄÖÜ][a-zäöüß]+/); // keine PLZ + Ort
    expect(src).not.toMatch(/HRB\s*\d|USt-IdNr\.?:?\s*DE\d/);
    expect(src).not.toMatch(/@[a-z0-9-]+\.[a-z]{2,}/i); // keine E-Mail-Adresse
  });

  it("Datenschutz weist aus, dass es keine endgültige Erklärung ist, und nennt Krankheitstage", () => {
    const src = read("datenschutz.tsx");
    expect(src).toContain("noch keine endgültige");
    expect(src).toContain("Status vor dem öffentlichen Release");
    expect(src).toContain("Gesundheitsbezug");
    expect(src).toContain("Gemini");
    expect(src).toContain("Tavily");
  });
});
