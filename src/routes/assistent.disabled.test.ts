/**
 * UI contract while the AI is off (source-level, like assistent.auth.test.ts): the stub renders
 * no chat input, no AiNoticeDialog, never reads chat history and never builds the AI context.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "assistent.tsx"), "utf8");
const rootSrc = readFileSync(join(here, "__root.tsx"), "utf8");
const kiSrc = readFileSync(join(here, "ki-hinweise.tsx"), "utf8");

function block(from: string, to?: string): string {
  const start = src.indexOf(from);
  expect(start).toBeGreaterThan(-1);
  return src.slice(start, to ? src.indexOf(to, start + from.length) : undefined);
}

describe("/assistent while the AI is off", () => {
  const stub = block("function AssistantUnavailable()", "function AssistantPage()");
  const page = block("function AssistantPage()");

  it("stub is German, has no input, notice dialog, history or context", () => {
    expect(stub).toMatch(/Vorübergehend nicht verfügbar/);
    for (const forbidden of [
      /Textarea/,
      /AiNoticeDialog/,
      /loadAiChatHistory/,
      /saveAiChatHistory/,
      /buildAssistantContext/,
      /getData/,
      /useServerFn/,
      /askAssistant/,
      /SUGGESTIONS/,
    ]) {
      expect(stub).not.toMatch(forbidden);
    }
  });

  it("the chat (history, context, notice, server call) is mounted only when enabled", () => {
    expect(page).toMatch(/availability === "enabled"\) return <AssistantChat \/>/);
    expect(page).not.toMatch(/loadAiChatHistory|buildAssistantContext|AiNoticeDialog|askAssistant/);
    const chat = block("function AssistantChat()", "/** Shown while the AI is switched off");
    expect(chat).toMatch(/loadAiChatHistory/);
    expect(chat).toMatch(/AiNoticeDialog/);
  });

  it("loading and error states fall back to non-chat UI", () => {
    expect(page).toMatch(/availability === "loading"/);
    expect(page).toMatch(/return <AssistantUnavailable \/>/);
  });

  it("route stays registered (no 404 for old links)", () => {
    expect(src).toMatch(/createFileRoute\("\/assistent"\)/);
  });
});

describe("navigation and legal page", () => {
  it("BottomNav filters the AI entry through the server-confirmed availability", () => {
    const start = rootSrc.indexOf("function BottomNav");
    const fn = rootSrc.slice(start, rootSrc.indexOf("\n}\n", start) + 3);
    expect(fn).toMatch(/useAiAvailability\(\)/);
    expect(fn).toMatch(/isNavItemAvailable\(n\.to, aiAvailability\)/);
  });

  it("/ki-hinweise keeps its content and shows the unavailable note unless enabled", () => {
    expect(kiSrc).toMatch(/availability !== "enabled"/);
    expect(kiSrc).toMatch(/KI vorübergehend nicht verfügbar/);
    expect(kiSrc).toMatch(/Aktuelle technische Provider/);
  });
});
