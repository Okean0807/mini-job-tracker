/**
 * Technical legal-readiness guards: no external font hosts, legal links reachable without login,
 * the AI notice before the first request, the opt-in for the Nominatim lookup, local data cleanup
 * on account deletion, and the draft legal texts staying drafts. No network, no Supabase.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LegalLinks } from "@/components/minijob/LegalLinks";
import { tl, type Lang } from "@/lib/i18n";
import { aiChatHistoryStorageKey, clearAiChatHistory } from "@/lib/minijob/ai-chat-history";
import {
  acknowledgeAiNotice,
  aiNoticeStorageKey,
  hasAcknowledgedAiNotice,
} from "@/lib/minijob/ai-notice";
import { clearUserScopeLocalData } from "@/lib/minijob/storage-scope";

const root = resolve(process.cwd());
const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");
const LANGS: Lang[] = ["de", "en", "ru", "tr", "pl"];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

describe("fonts are self-hosted", () => {
  it("has no Google Fonts host in any non-test source file", () => {
    const offenders = walk(resolve(root, "src"))
      .filter((f) => /\.(ts|tsx|css)$/.test(f) && !/\.test\.tsx?$/.test(f))
      .filter((f) => /fonts\.googleapis\.com|fonts\.gstatic\.com/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("declares Manrope from local files with the license next to them", () => {
    const css = read("src/styles.css");
    expect(css).toMatch(/@font-face[^}]*font-family:\s*"Manrope"/);
    const files = [...css.matchAll(/url\("\.\/(assets\/fonts\/manrope\/[^"]+\.woff2)"\)/g)].map(
      (m) => m[1]!,
    );
    expect(files.length).toBeGreaterThanOrEqual(2);
    for (const f of files) expect(existsSync(resolve(root, "src", f))).toBe(true);
    expect(read("src/assets/fonts/manrope/OFL-LICENSE.txt")).toMatch(/SIL OPEN FONT LICENSE/i);
    expect(css).toMatch(/--font-sans:\s*"Manrope"/);
  });
});

describe("legal links", () => {
  it("renders Impressum, Datenschutz and KI-Hinweise", () => {
    const html = renderToStaticMarkup(LegalLinks({}));
    for (const href of ["/impressum", "/datenschutz", "/ki-hinweise"]) {
      expect(html).toContain(`href="${href}"`);
    }
  });

  it("opens in a new tab with noopener when asked", () => {
    const html = renderToStaticMarkup(LegalLinks({ newTab: true }));
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("is shown on the sign-in screens and in the AI area", () => {
    expect(read("src/components/minijob/OnboardingWizard.tsx")).toMatch(/<LegalLinks\b/);
    expect(read("src/routes/einstellungen.tsx")).toMatch(/<LegalLinks\b/);
    expect(read("src/routes/assistent.tsx")).toMatch(/<LegalLinks\b/);
  });

  it("the legal pages do not depend on a login", () => {
    for (const f of ["impressum", "datenschutz", "ki-hinweise"]) {
      const src = read(`src/routes/${f}.tsx`);
      expect(src).not.toMatch(/useAuthSession|requireSupabaseAuth|supabase/);
    }
  });
});

describe("AI notice before the first request", () => {
  it("checks the acknowledgement before building the context or calling the server function", () => {
    const src = read("src/routes/assistent.tsx");
    const askStart = src.indexOf("async function ask(text: string)");
    const gate = src.indexOf("hasAcknowledgedAiNotice(userId)", askStart);
    const ctx = src.indexOf("buildAssistantContext(getData())", askStart);
    const send = src.indexOf("call({ data:", askStart);
    expect(askStart).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(askStart);
    expect(gate).toBeLessThan(ctx);
    expect(gate).toBeLessThan(send);
    expect(src).toMatch(/<AiNoticeDialog\b/);
  });

  it("cancelling clears the pending question and sends nothing", () => {
    const src = read("src/routes/assistent.tsx");
    const cancel = src.slice(src.indexOf("function onNoticeCancel()"));
    expect(cancel.slice(0, 200)).toMatch(/pendingQuestion\.current = null/);
    expect(cancel.slice(0, 200)).not.toMatch(/\bask\(|call\(/);
  });

  it("stores the acknowledgement per user and in a key removed on account deletion", () => {
    window.localStorage.clear();
    expect(hasAcknowledgedAiNotice("u1")).toBe(false);
    expect(acknowledgeAiNotice("u1")).toBe(true);
    expect(hasAcknowledgedAiNotice("u1")).toBe(true);
    expect(hasAcknowledgedAiNotice("u2")).toBe(false);
    expect(aiNoticeStorageKey("u1").endsWith(":u:u1")).toBe(true);
    clearUserScopeLocalData("u1");
    expect(hasAcknowledgedAiNotice("u1")).toBe(false);
  });

  it.each(LANGS)("explains transfer, providers and non-anonymity in %s", (lang) => {
    const all = ["ai.notice.intro", "ai.notice.data", "ai.notice.providers", "ai.notice.optional"]
      .map((k) => tl(lang, k))
      .join(" ");
    expect(all).toMatch(/Google/);
    expect(all).toMatch(/Tavily/);
    expect(all).toMatch(/USA|США|ABD/);
    // Never claim anonymity: the only allowed mention is the explicit "not anonymised" statement.
    const claims = all.replace(
      /nicht anonymisiert|not anonymised|не анонимизируется|anonimleştirilmez|nie jest zanonimizowane/gi,
      "",
    );
    expect(claims).not.toMatch(/anonym|anonim|анонимн/i);
    for (const k of [
      "ai.notice.title",
      "ai.notice.confirm",
      "ai.notice.cancel",
      "ai.privacy.hint",
    ]) {
      expect(tl(lang, k).length).toBeGreaterThan(3);
    }
  });
});

describe("Nominatim lookup is opt-in", () => {
  const src = read("src/components/minijob/ShiftDialog.tsx");

  it("sends coordinates only from the confirm handler, never from the capture button", () => {
    const calls = [...src.matchAll(/reverseGeocodeGerman\(/g)];
    expect(calls).toHaveLength(1);
    const confirmStart = src.indexOf("async function confirmGeoLookup()");
    expect(confirmStart).toBeGreaterThan(-1);
    expect(src.indexOf("reverseGeocodeGerman(pos.lat, pos.lng)")).toBeGreaterThan(confirmStart);
    const capture = src.slice(src.indexOf("await currentPosition()"));
    expect(capture.slice(0, 400)).toMatch(/promptGeoLookup\(pos\)/);
  });

  it("declining keeps the GPS and shows a neutral message", () => {
    const decline = src.slice(src.indexOf("function declineGeoLookup()"));
    expect(decline.slice(0, 300)).toMatch(/worklog\.geoNotice\.skipped/);
    expect(decline.slice(0, 300)).not.toMatch(/setGps\(undefined\)/);
  });

  it.each(LANGS)("names the service and the IP address in %s", (lang) => {
    const body = tl(lang, "worklog.geoNotice.body");
    expect(body).toMatch(/Nominatim/);
    expect(body).toMatch(/OpenStreetMap/);
    expect(body).toMatch(/IP/);
  });
});

describe("account deletion removes local personal data of the account", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => window.localStorage.clear());

  it("client calls the chat-history cleanup after the scope cleanup", () => {
    const src = read("src/lib/minijob/account-delete.ts");
    expect(src).toMatch(/clearAiChatHistory\(userId\)/);
    expect(src.indexOf("clearUserScopeLocalData(userId)")).toBeLessThan(
      src.indexOf("clearAiChatHistory(userId)"),
    );
  });

  it("removes this user's AI chat history, notice flag and scoped data, and keeps other users'", () => {
    const ls = window.localStorage;
    ls.setItem(aiChatHistoryStorageKey("u1"), "[]");
    ls.setItem(aiChatHistoryStorageKey("u2"), "[]");
    ls.setItem("minijob-tracker-v1:u:u1", "{}");
    ls.setItem("minijob-tracker-v1:u:u2", "{}");
    acknowledgeAiNotice("u1");
    acknowledgeAiNotice("u2");

    clearUserScopeLocalData("u1");
    clearAiChatHistory("u1");

    expect(ls.getItem(aiChatHistoryStorageKey("u1"))).toBeNull();
    expect(ls.getItem("minijob-tracker-v1:u:u1")).toBeNull();
    expect(hasAcknowledgedAiNotice("u1")).toBe(false);
    expect(ls.getItem(aiChatHistoryStorageKey("u2"))).not.toBeNull();
    expect(ls.getItem("minijob-tracker-v1:u:u2")).not.toBeNull();
    expect(hasAcknowledgedAiNotice("u2")).toBe(true);
  });
});

describe("public deletion wording matches what the code guarantees", () => {
  const page = read("src/routes/datenschutz.tsx").replace(/\s+/g, " ");
  const handler = read("supabase/functions/delete-account/handler.ts");
  const client = read("src/lib/minijob/account-delete.ts");
  const start = page.indexOf("„Konto löschen“");
  const item = page.slice(start, page.indexOf("</li>", start));

  it("separates app cloud copies from the provider's technical backups", () => {
    expect(item).toContain(
      "Cloud-Sicherungen deiner App-Daten (technische Sicherungskopien des Anbieters sind davon nicht umfasst)",
    );
    // The ambiguous word that could be read as "all backups incl. infrastructure" must not return.
    expect(item).not.toMatch(/\bBackups\b/);
  });

  it("makes no blanket or guaranteed-erasure promise", () => {
    expect(item).not.toMatch(
      /alle (deine )?Daten|sämtliche|vollständig|restlos|unwiderruflich|sofort|garantiert/i,
    );
  });

  it("every item named on the page is deleted by the server function", () => {
    // Dokumente (Storage objects + rows), Ordner, Cloud-Sicherungen (= backups table), Konto (Auth user)
    expect(handler).toMatch(/BUCKET = ["']documents["']/);
    expect(handler).toMatch(/\[\s*"documents",\s*"document_folders",\s*"backups"\s*\] as const/);
    expect(handler).toMatch(/auth\.admin\.deleteUser\(user\.id\)/);
    expect(item).toMatch(/Dokumente, Ordner, Cloud-Sicherungen/);
  });

  it("local data is only removed after the server confirmed the deletion", () => {
    const failed = client.indexOf("if (error) return { ok: false, error };");
    expect(failed).toBeGreaterThan(-1);
    expect(failed).toBeLessThan(client.indexOf("clearUserScopeLocalData(userId)"));
    expect(failed).toBeLessThan(client.indexOf("clearAiChatHistory(userId)"));
  });
});

describe("draft legal texts stay drafts", () => {
  const dir = "docs/legal";
  const drafts = [
    "Impressum_ENTWURF.md",
    "Datenschutzerklaerung_ENTWURF.md",
    "Nutzungsbedingungen_ENTWURF.md",
  ];

  it.each(drafts)("%s is marked as a draft and still has open fields", (name) => {
    const text = read(`${dir}/${name}`);
    expect(text.split("\n")[0]).toMatch(/ENTWURF – NICHT VERÖFFENTLICHEN/);
    expect(text).toMatch(/\[\[AUSFÜLLEN/);
  });

  it.each(drafts)("%s contains no real contact data", (name) => {
    const text = read(`${dir}/${name}`);
    expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i); // no e-mail address
    expect(text).not.toMatch(/\+?\d{2,4}[\s/-]?\d{3,}[\s/-]?\d{3,}/); // no phone number
    expect(text).not.toMatch(/\b\d{5}\s+[A-ZÄÖÜ][a-zäöüß]+/); // no "PLZ Ort"
  });

  it("the app never imports or renders the drafts", () => {
    const offenders = walk(resolve(root, "src"))
      .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f))
      .filter((f) => /docs\/legal|_ENTWURF/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("the public pages still declare their interim status until real texts are published", () => {
    expect(read("src/routes/impressum.tsx")).toMatch(/Noch nicht veröffentlicht/);
    expect(read("src/routes/datenschutz.tsx")).toMatch(/noch keine endgültige/);
  });
});
