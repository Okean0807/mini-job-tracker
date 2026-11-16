/**
 * While the AI assistant is switched off (AI_FEATURES_ENABLED not "true", PR #161) no reachable user text
 * may describe Gemini, Tavily or the AI as a working feature or as a current data recipient. Source-level
 * guards in the style of legal-readiness.test.ts: no network, no rendering.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { LANGUAGES, type Lang } from "@/lib/i18n/core";
import { a11y } from "@/lib/i18n/dict/a11y";
import { annual } from "@/lib/i18n/dict/annual";
import { assistant } from "@/lib/i18n/dict/assistant";
import { common } from "@/lib/i18n/dict/common";
import { dashboard } from "@/lib/i18n/dict/dashboard";
import { docsDict } from "@/lib/i18n/dict/docs";
import { entry } from "@/lib/i18n/dict/entry";
import { goalsDict } from "@/lib/i18n/dict/goals";
import { hoursDict } from "@/lib/i18n/dict/hours";
import { jobsDict } from "@/lib/i18n/dict/jobs";
import { localDataDict } from "@/lib/i18n/dict/local-data";
import { objectsDict } from "@/lib/i18n/dict/objects";
import { ordersDict } from "@/lib/i18n/dict/orders";
import { reports } from "@/lib/i18n/dict/reports";
import { settingsDict } from "@/lib/i18n/dict/settings";
import { v2 } from "@/lib/i18n/dict/v2";
import { widgets } from "@/lib/i18n/dict/widgets";
import { wizard } from "@/lib/i18n/dict/wizard";
import { worklog } from "@/lib/i18n/dict/worklog";

const root = resolve(process.cwd());
const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");
const LANGS = LANGUAGES.map((l) => l.code) as Lang[];

/** Any wording that presents the AI, or one of its providers, to the user. */
const AI_ACRONYMS = /\bKI\b|KI-|\bAI\b|\bYZ\b|ИИ/;
const AI_WORDS = /gemini|tavily|yapay zek|sztuczn|künstliche|artificial intelligence/i;
const AI_WORDING = {
  test: (text: string) => AI_ACRONYMS.test(text) || AI_WORDS.test(text),
};

const BUNDLES = [
  a11y,
  annual,
  common,
  dashboard,
  docsDict,
  entry,
  goalsDict,
  hoursDict,
  jobsDict,
  localDataDict,
  objectsDict,
  ordersDict,
  reports,
  settingsDict,
  v2,
  widgets,
  wizard,
  worklog,
];

/** Navigation labels: the AI entry is filtered out of the navigation and the mode preview while off. */
const NAV_LABEL_KEYS = new Set(["nav.ai", "ui.feature.nav.ai"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

describe("translations: no reachable text promises the AI", () => {
  it.each(LANGS)("%s: only the dormant ai.* texts and nav labels mention the AI", (lang) => {
    const offenders: string[] = [];
    for (const bundle of BUNDLES) {
      for (const [key, value] of Object.entries(bundle[lang])) {
        if (key.startsWith("ai.") || NAV_LABEL_KEYS.has(key)) continue;
        if (AI_WORDING.test(value)) offenders.push(`${key}: ${value}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it.each(LANGS)("%s: Premium description no longer lists an AI analysis", (lang) => {
    const desc = entry[lang]["premium.settingsDesc"] ?? "";
    expect(desc.length).toBeGreaterThan(20);
    expect(AI_WORDING.test(desc)).toBe(false);
    // The other Premium features stay in the description.
    expect(desc).toMatch(/Excel/);
  });

  it("the dormant ai.* texts exist in every language (kept for a later re-enable)", () => {
    for (const lang of LANGS) {
      expect(assistant[lang]["ai.notice.providers"]).toMatch(/Gemini/);
      expect(assistant[lang]["ai.privacy.hint"]?.length).toBeGreaterThan(20);
    }
  });

  it("ai.* keys are used only by the chat page and its notice dialog", () => {
    const users = walk(resolve(root, "src"))
      .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f) && !f.includes("/i18n/dict/"))
      .filter((f) => /["'`]ai\.[a-zA-Z.]+["'`]/.test(readFileSync(f, "utf8")))
      .map((f) => relative(root, f).replaceAll("\\", "/"))
      .sort();
    expect(users).toEqual([
      "src/components/minijob/AiNoticeDialog.tsx",
      "src/routes/assistent.tsx",
    ]);
  });
});

describe("/datenschutz does not describe the AI as active", () => {
  const src = read("src/routes/datenschutz.tsx");

  it("names neither Gemini nor Tavily as a current recipient", () => {
    expect(src).not.toMatch(/Gemini|Tavily/);
    expect(src).not.toMatch(/KI-Anfrage|KI-Antworten|serverseitige KI-Funktion/);
  });

  it("states that the AI is unavailable and nothing is sent to AI services", () => {
    expect(src).toMatch(/nicht\s+verfügbar/);
    expect(src).toMatch(/keine Anfragen an KI-Dienste gesendet/);
  });

  it("stays an honest interim text, not a finished privacy policy", () => {
    expect(src).toMatch(/noch keine endgültige/);
    expect(src).toMatch(/Status vor dem öffentlichen Release/);
  });
});

describe("/ki-hinweise", () => {
  const src = read("src/routes/ki-hinweise.tsx");
  const unavailableAt = src.indexOf('availability !== "enabled"');
  const enabledAt = src.indexOf(") : (", unavailableAt);
  const unavailableBranch = src.slice(unavailableAt, enabledAt);
  const enabledBranch = src.slice(enabledAt);

  it("shows only the unavailability notice while the AI is off", () => {
    expect(unavailableAt).toBeGreaterThan(-1);
    expect(enabledAt).toBeGreaterThan(unavailableAt);
    expect(unavailableBranch).toMatch(/data-testid="ki-hinweise-unavailable"/);
    expect(unavailableBranch).toMatch(/nicht verfügbar/);
    expect(unavailableBranch).toMatch(/keine Anfragen an KI-Dienste gesendet/);
    expect(unavailableBranch).not.toMatch(/Gemini|Tavily|Provider|weitergegeben/);
  });

  it("keeps provider descriptions out of everything rendered while the AI is off", () => {
    const beforeEnabledBranch = src.slice(0, enabledAt);
    expect(beforeEnabledBranch).not.toMatch(/Gemini|Tavily|Aktuelle technische Provider/);
    // The architecture description is kept, but only for the enabled state.
    expect(enabledBranch).toMatch(/Aktuelle technische Provider/);
    expect(enabledBranch).toMatch(/Gemini/);
  });

  it("is still linked from the legal overview", () => {
    expect(read("src/lib/minijob/legal-links.ts")).toMatch(/\/ki-hinweise/);
  });
});

describe("other reachable surfaces", () => {
  it("the /assistent page metadata does not advertise a working assistant", () => {
    const src = read("src/routes/assistent.tsx");
    const head = src.slice(src.indexOf("head: () =>"), src.indexOf("component: AssistantPage"));
    expect(head).toMatch(/nicht verfügbar/);
    expect(head).not.toMatch(/Frage den KI-Assistenten|Prognosen|per Frage analysieren/);
  });

  it("the /rechtliches intro does not promise AI information", () => {
    expect(read("src/routes/rechtliches.tsx")).not.toMatch(/KI-Assistenten/);
  });

  it("the settings mode preview lists the AI navigation entry only when the AI is available", () => {
    const src = read("src/routes/einstellungen.tsx");
    expect(src).toMatch(
      /NAV_PREVIEW\.filter\(\(f\) => f !== "nav\.ai" \|\| aiAvailability === "enabled"\)/,
    );
    expect(src).toMatch(/navPreview\.map\(/);
    expect(src).not.toMatch(/NAV_PREVIEW\.map\(/);
  });
});
