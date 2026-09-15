/**
 * Regression O/K: KI must not look usable when signed_out; unavailable/unauthorized
 * must surface via toast + chat message (not silent hang).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "assistent.tsx"), "utf8");
const fnSrc = readFileSync(join(here, "../lib/ai.functions.ts"), "utf8");

describe("KI auth gate (assistent.tsx) — acceptance O", () => {
  it("uses shared useAuthSession", () => {
    expect(src).toMatch(/useAuthSession/);
    expect(src).not.toMatch(/getSession\(/);
    expect(src).not.toMatch(/onAuthStateChange/);
  });

  it("shows ai.signedOut only when signed_out (not while loading)", () => {
    const renderStart = src.indexOf("return (");
    const render = src.slice(renderStart);
    expect(render).toMatch(/authStatus === "loading"/);
    expect(render).toMatch(/authStatus === "signed_out"/);
    const loadingAt = render.indexOf('authStatus === "loading"');
    const signedOutBranchAt = render.indexOf('authStatus === "signed_out"');
    const signedOutAt = render.indexOf('t("ai.signedOut")');
    expect(loadingAt).toBeGreaterThan(-1);
    expect(signedOutBranchAt).toBeGreaterThan(loadingAt);
    expect(signedOutAt).toBeGreaterThan(signedOutBranchAt);
  });

  it("does not render suggestions/input while signed_out", () => {
    const gateAt = src.indexOf('authStatus === "signed_out"');
    const signedOutEnd = src.indexOf(") : (", gateAt);
    expect(gateAt).toBeGreaterThan(-1);
    expect(signedOutEnd).toBeGreaterThan(gateAt);
    const signedOutBlock = src.slice(gateAt, signedOutEnd);
    expect(signedOutBlock).toMatch(/ai\.signedOut/);
    expect(signedOutBlock).not.toMatch(/SUGGESTIONS/);
    expect(signedOutBlock).not.toMatch(/Textarea/);
    // Chat UI lives only in the signed-in branch after the signed_out ternary.
    const signedIn = src.slice(signedOutEnd);
    expect(signedIn).toMatch(/SUGGESTIONS\.map/);
    expect(signedIn).toMatch(/Textarea/);
  });

  it("refuses ask() when not signed_in before calling the server", () => {
    expect(src).toMatch(/authStatus !== "signed_in"/);
    expect(src).toMatch(/toast\.error\(t\("ai\.signedOut"\)\)/);
  });
});

describe("KI error surfacing (assistent.tsx) — acceptance K", () => {
  it("uses aiClientErrorMessage and shows toast + chat on failure", () => {
    expect(src).toMatch(/aiClientErrorMessage/);
    expect(src).toMatch(/toast\.error\(message\)/);
    expect(src).toMatch(/setMessages\(\(m\) => \[\.\.\.m, \{ role: "ai", text: message \}\]\)/);
  });

  it("uses runAssistantAsk + client timeout so pending cannot stick on hang", () => {
    expect(src).toMatch(/runAssistantAsk/);
    expect(src).toMatch(/ASK_CLIENT_TIMEOUT_MS/);
    expect(src).toMatch(/ai\.error\.timeout/);
  });
});

describe("askAssistant server auth + missing key (ai.functions.ts)", () => {
  it("keeps requireSupabaseAuth middleware (no auth weaken)", () => {
    expect(fnSrc).toMatch(/middleware\(\[requireSupabaseAuth\]\)/);
  });

  it("throws clear unavailable when LOVABLE_API_KEY missing", () => {
    expect(fnSrc).toMatch(/process\.env\["LOVABLE_API_KEY"\]/);
    expect(fnSrc).toMatch(/KI ist derzeit nicht verfügbar/);
  });

  it("aborts hung gateway fetch with AbortSignal.timeout (hang root cause)", () => {
    expect(fnSrc).toMatch(/AbortSignal\.timeout\(ASK_GATEWAY_TIMEOUT_MS\)/);
    expect(fnSrc).toMatch(/isAbortOrTimeoutError/);
    expect(fnSrc).toMatch(/ASK_GATEWAY_TIMEOUT_MESSAGE/);
  });
});
