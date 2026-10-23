import { describe, expect, it } from "vitest";

import { HEALTH_GATE_SAMPLES } from "./__fixtures__/health-privacy-samples";
import {
  ALLOWED_CONTEXT_KEYS,
  CONTEXT_INVALID,
  HEALTH_DATA_BLOCKED,
  HEALTH_DATA_BLOCKED_MESSAGE,
  checkAiPrivacy,
  checkContext,
  containsPersonalHealthInfo,
} from "./health-privacy-gate";
import { buildAssistantContext } from "@/lib/minijob/ai-context";
import { DEFAULT_SETTINGS, type AppData } from "@/lib/minijob/types";

function emptyData(): AppData {
  return {
    shifts: [
      {
        id: "s1",
        kind: "arbeit",
        date: "2026-03-10",
        start: "09:00",
        end: "13:00",
        breakMinutes: 0,
        jobId: "j1",
        note: "AU wegen Grippe (Notiz darf nie in den Kontext)",
      },
    ],
    jobs: [{ id: "j1", name: "Café", color: "#0d9488", mode: "flex", rate: 13.9 }],
    customers: [],
    projects: [],
    payments: [],
    goals: [],
    orders: [],
    objects: [],
    settings: { ...DEFAULT_SETTINGS, defaultRate: 13.9 },
    timer: null,
  };
}

const decide = (t: string) => (containsPersonalHealthInfo(t) ? "block" : "pass");

describe("health privacy gate: personal health info is blocked", () => {
  it.each([
    "Ich bin krank mit Fieber.",
    "Ich bin seit gestern krank wegen Corona.",
    "Meine Diagnose lautet Depression.",
    "AU wegen Grippe bis Mittwoch.",
    "Ich nehme Medikamente gegen Migräne.",
    "Ich bin schwanger.",
    "Ich bin schwerbehindert.",
    "Meine Therapeutin sagt, ich soll weniger arbeiten.",
    "Mein Sohn ist krank und liegt im Krankenhaus.",
    "Diagnose F32.1 laut Hausarzt",
    "Notiz: krankgeschrieben wegen Bronchitis",
    "I'm sick and on antibiotics, will I be paid?",
    "My therapist recommended fewer shifts.",
  ])("blocks %s", (text) => {
    expect(decide(text)).toBe("block");
  });
});

describe("health privacy gate: general legal / payroll questions pass", () => {
  it.each([
    "Lohnfortzahlung im Krankheitsfall",
    "Wie viele Krankheitstage werden bezahlt?",
    "Krankenversicherung Minijob",
    "6-Wochen-Regel",
    "Entgeltfortzahlung im Minijob nach EntgFG",
    "Wie hoch ist die Minijob-Grenze 2026?",
    "Wie viele Stunden habe ich im März gearbeitet?",
    "Was verdiene ich, wenn ich 10 Stunden mehr arbeite?",
    "",
  ])("passes %s", (text) => {
    expect(decide(text)).toBe("pass");
  });
});

describe("FP/FN evaluation set (>= 30 samples, DE + EN)", () => {
  it("has at least 30 samples incl. English", () => {
    expect(HEALTH_GATE_SAMPLES.length).toBeGreaterThanOrEqual(30);
    expect(HEALTH_GATE_SAMPLES.some((s) => s.lang === "en")).toBe(true);
  });
  it.each(HEALTH_GATE_SAMPLES.map((s) => [s.id, s] as const))("%s", (_id, s) => {
    expect(decide(s.text)).toBe(s.residualActual ?? s.ideal);
  });
});

describe("checkContext: server does not trust client context", () => {
  it("accepts the real buildAssistantContext output (all keys allow-listed)", () => {
    const data = emptyData();
    const ctx = buildAssistantContext(data, new Date("2026-03-15T12:00:00Z"));
    expect(checkContext(ctx)).toEqual({ allowed: true });
  });

  it("accepts empty context string", () => {
    expect(checkContext("")).toEqual({ allowed: true });
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["number", 42],
    ["object (not string)", { jobs: [] }],
    ["not JSON", "Datenbasis: Ich bin krank"],
    ["truncated JSON", '{"jobs":[{"name":"A"'],
  ])("fails closed on malformed context (%s)", (_label, ctx) => {
    const r = checkContext(ctx);
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.code).toBe(CONTEXT_INVALID);
  });

  it.each([
    ["JSON array root", "[1,2]"],
    ["JSON string root", '"hallo"'],
    ["unknown key (forged absence notes)", JSON.stringify({ absences: [{ note: "x" }] })],
    ["unknown nested key", JSON.stringify({ jobs: [{ name: "A", sickNote: "x" }] })],
    ["oversized string", JSON.stringify({ jobs: [{ name: "x".repeat(501) }] })],
    [
      "too deep",
      JSON.stringify({ jobs: [[[[[[[{ name: "A" }]]]]]]] }),
    ],
  ])("fails closed on unexpected shape (%s)", (_label, ctx) => {
    const r = checkContext(ctx);
    expect(r.allowed).toBe(false);
    if (!r.allowed) {
      expect(r.code).toBe(CONTEXT_INVALID);
      expect(r.reason).toBe("context_unexpected_shape");
    }
  });

  it("blocks personal health info hidden in allow-listed free text (job name)", () => {
    const ctx = JSON.stringify({ jobs: [{ id: "j1", name: "AU wegen Grippe – Dr. Beispiel" }] });
    const r = checkContext(ctx);
    expect(r).toMatchObject({ allowed: false, code: HEALTH_DATA_BLOCKED, reason: "context_personal_health" });
  });

  it("allow-list covers every key of the context payload type", () => {
    for (const k of ["currentDate", "settings", "currentMonth", "year", "historicalYears", "months", "jobs"]) {
      expect(ALLOWED_CONTEXT_KEYS.has(k)).toBe(true);
    }
  });
});

describe("checkAiPrivacy", () => {
  it("blocks on question with German structured message", () => {
    const r = checkAiPrivacy({ question: "Ich bin krank wegen Grippe", context: "" });
    expect(r).toEqual({
      allowed: false,
      code: HEALTH_DATA_BLOCKED,
      reason: "question_personal_health",
      message: HEALTH_DATA_BLOCKED_MESSAGE,
    });
    expect(HEALTH_DATA_BLOCKED_MESSAGE).toMatch(/Datenschutz/);
    expect(HEALTH_DATA_BLOCKED_MESSAGE).toMatch(/nichts an den KI-Dienst gesendet/);
  });

  it("fails closed when question is not a string", () => {
    const r = checkAiPrivacy({ question: undefined, context: "" });
    expect(r).toMatchObject({ allowed: false, code: CONTEXT_INVALID, reason: "input_malformed" });
  });

  it("allows general question with valid context", () => {
    const ctx = buildAssistantContext(emptyData(), new Date("2026-03-15T12:00:00Z"));
    expect(checkAiPrivacy({ question: "Lohnfortzahlung im Krankheitsfall", context: ctx })).toEqual({
      allowed: true,
    });
  });
});
