/**
 * Known limits of the L1 health privacy gate (heuristic, regex based).
 *
 * These cases pin the CURRENT decisions so any change of the detector is visible in
 * review. They are NOT a statement that the decisions are right: "missed" cases are
 * personal health statements that currently pass, "blocked" cases are general questions
 * that currently get blocked. The gate is an additional data-minimisation layer and
 * must not be described as detecting all health information.
 * Sources: documented residuals R01–R05 in __fixtures__/health-privacy-samples.ts and
 * an audit probe of colloquial German/English phrasings.
 */
import { describe, expect, it } from "vitest";

import { containsPersonalHealthInfo } from "./health-privacy-gate";

describe("health privacy gate: known false negatives (personal statement currently passes)", () => {
  it.each([
    "Bandscheibenvorfall – wie lange zahlt der Arbeitgeber?",
    "Hatte gestern einen Arbeitsunfall und mir tut die Hand weh.",
    "Feeling really depressed lately, can I take unpaid leave?",
    "Bin heute nicht arbeitsfähig, Rücken",
    "OP am Knie nächste Woche, was nun?",
    "Habe eine Erkältung",
    "I have a cold and cannot work",
    "Burnout",
    "Schwangerschaft melden?",
    "Ich muss morgen zum Arzt wegen Blutdruck",
    "Am Montag fehle ich, Zahn-OP",
  ])("passes (known miss): %s", (text) => {
    expect(containsPersonalHealthInfo(text)).toBe(false);
  });
});

describe("health privacy gate: known false positives (general question currently blocked)", () => {
  it.each([
    "Muss ich bei einer Grippe sofort eine Krankmeldung abgeben?",
    "Ich arbeite in einer Physiotherapie-Praxis, zählt das als Minijob?",
  ])("blocks (known over-block): %s", (text) => {
    expect(containsPersonalHealthInfo(text)).toBe(true);
  });
});

describe("health privacy gate: general payroll questions keep passing", () => {
  it.each([
    "Wie funktioniert Lohnfortzahlung im Krankheitsfall?",
    "Wie viele Krankheitstage zahlt der Arbeitgeber im Minijob?",
    "Was ist die Minijob-Grenze 2026?",
    "Zählt Urlaubsgeld zum Minijob-Einkommen?",
    "Ich möchte wissen, wie viel ich noch verdienen darf",
    "Meine Krankenkasse ist die AOK, muss ich Beiträge zahlen?",
    "Muss ich im Minijob eine Krankmeldung vorlegen?",
    "Wie hoch ist mein Verdienst im Mai?",
    "Mein Chef zahlt mir bei Krankheit nichts, ist das legal?",
  ])("passes: %s", (text) => {
    expect(containsPersonalHealthInfo(text)).toBe(false);
  });
});
