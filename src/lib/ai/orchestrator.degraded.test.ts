/** The diagnostics marker `degraded` set by the LLM provider survives every orchestrator path. */
import { describe, expect, it, vi } from "vitest";

import { OrchestratingAIProvider, WEB_SEARCH_QUOTA_NOTE } from "./orchestrator";
import { GROUNDING_UNAVAILABLE_NOTE } from "./gemini-provider";
import type { AIProvider, AskResponse } from "./types";
import type { WebSearchProvider } from "./web-search/provider";
import type { WebSearchOutcome } from "./web-search/types";

const llm = (response: AskResponse): AIProvider => ({ ask: vi.fn(async () => response) });
const search = (outcome: WebSearchOutcome): WebSearchProvider => ({
  search: vi.fn(async () => outcome),
});
const DEGRADED: AskResponse = {
  answer: "Teil\n\nHinweis: möglicherweise unvollständig",
  degraded: "truncated",
};
const CURRENT_INFO = "Wie hoch ist die Minijob-Grenze 2026?";
const CALC = "Berechne die Summe von 3 Stunden mal 15 Euro";

describe("OrchestratingAIProvider keeps the degraded marker", () => {
  it("no web search needed", async () => {
    const orch = new OrchestratingAIProvider({
      llm: llm(DEGRADED),
      webSearch: search({ ok: true, results: [] }),
    });
    expect(await orch.ask({ question: CALC, context: "{}" })).toEqual(DEGRADED);
  });

  it("search unavailable (quota note appended)", async () => {
    const orch = new OrchestratingAIProvider({
      llm: llm(DEGRADED),
      webSearch: search({ ok: false, reason: "quota_exhausted" } as WebSearchOutcome),
    });
    const out = await orch.ask({ question: CURRENT_INFO, context: "{}" });
    expect(out.degraded).toBe("truncated");
    expect(out.answer).toContain(WEB_SEARCH_QUOTA_NOTE);
    expect(out.answer).toContain("unvollständig");
  });

  it("empty search results (grounding-unavailable note appended)", async () => {
    const orch = new OrchestratingAIProvider({
      llm: llm(DEGRADED),
      webSearch: search({ ok: true, results: [] }),
    });
    const out = await orch.ask({ question: CURRENT_INFO, context: "{}" });
    expect(out.degraded).toBe("truncated");
    expect(out.answer).toContain(GROUNDING_UNAVAILABLE_NOTE);
  });

  it("search() throws a non-abort error → LLM still answers, grounding note, marker kept", async () => {
    const orch = new OrchestratingAIProvider({
      llm: llm(DEGRADED),
      webSearch: { search: vi.fn(async () => Promise.reject(new Error("tavily down"))) },
    });
    const out = await orch.ask({ question: CURRENT_INFO, context: "{}" });
    expect(out.degraded).toBe("truncated");
    expect(out.answer).toContain(GROUNDING_UNAVAILABLE_NOTE);
    expect(out.answer).not.toContain("tavily down");
    expect(out.sources).toBeUndefined();
  });

  it.each(["AbortError", "TimeoutError"])(
    "search() throwing %s is rethrown and the LLM is not called",
    async (name) => {
      const abort = Object.assign(new Error("deadline"), { name });
      const model = llm(DEGRADED);
      const orch = new OrchestratingAIProvider({
        llm: model,
        webSearch: { search: vi.fn(async () => Promise.reject(abort)) },
      });
      await expect(orch.ask({ question: CURRENT_INFO, context: "{}" })).rejects.toBe(abort);
      expect(model.ask).not.toHaveBeenCalled();
    },
  );

  it("results without a usable URL yield no sources → grounding note, marker kept", async () => {
    const orch = new OrchestratingAIProvider({
      llm: llm(DEGRADED),
      webSearch: search({
        ok: true,
        results: [{ title: "Ohne Link", url: "   ", snippet: "x" }],
      }),
    });
    const out = await orch.ask({ question: CURRENT_INFO, context: "{}" });
    expect(out.degraded).toBe("truncated");
    expect(out.answer).toContain(GROUNDING_UNAVAILABLE_NOTE);
    expect(out.sources).toBeUndefined();
  });

  it("successful search with sources", async () => {
    const orch = new OrchestratingAIProvider({
      llm: llm(DEGRADED),
      webSearch: search({
        ok: true,
        results: [{ title: "BMAS", url: "https://www.bmas.de/minijob", snippet: "Grenze" }],
      }),
    });
    const out = await orch.ask({ question: CURRENT_INFO, context: "{}" });
    expect(out.degraded).toBe("truncated");
    expect(out.sources?.length).toBeGreaterThan(0);
  });

  it("clean answers get no marker on any path", async () => {
    const clean: AskResponse = { answer: "Antwort" };
    const orch = new OrchestratingAIProvider({
      llm: llm(clean),
      webSearch: search({ ok: true, results: [] }),
    });
    for (const question of [CALC, CURRENT_INFO]) {
      expect(await orch.ask({ question, context: "{}" })).not.toHaveProperty("degraded");
    }
  });
});
