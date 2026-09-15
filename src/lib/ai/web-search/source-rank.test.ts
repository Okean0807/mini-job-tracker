import { describe, expect, it } from "vitest";

import {
  classifyHostTier,
  RANKED_RESULT_LIMIT,
  RANKED_RESULT_MAX,
  rankWebSearchResults,
} from "./source-rank";

describe("classifyHostTier", () => {
  it("classifies Tier 1 official domains", () => {
    expect(classifyHostTier("www.minijob-zentrale.de")).toBe(1);
    expect(classifyHostTier("bmas.de")).toBe(1);
    expect(classifyHostTier("www.gesetze-im-internet.de")).toBe(1);
    expect(classifyHostTier("eur-lex.europa.eu")).toBe(1);
    expect(classifyHostTier("ec.europa.eu")).toBe(1);
    expect(classifyHostTier("mindestlohnkommission.de")).toBe(1);
  });

  it("classifies Tier 2 trusted secondary", () => {
    expect(classifyHostTier("www.ihk.de")).toBe(2);
    expect(classifyHostTier("hwk-muenchen.handwerkskammer.de")).toBe(2);
    expect(classifyHostTier("www.verbraucherzentrale.de")).toBe(2);
    expect(classifyHostTier("www.test.de")).toBe(2);
  });

  it("classifies Tier 4 social / UGC", () => {
    expect(classifyHostTier("www.facebook.com")).toBe(4);
    expect(classifyHostTier("twitter.com")).toBe(4);
    expect(classifyHostTier("x.com")).toBe(4);
    expect(classifyHostTier("www.reddit.com")).toBe(4);
    expect(classifyHostTier("www.youtube.com")).toBe(4);
    expect(classifyHostTier("www.linkedin.com")).toBe(4);
  });

  it("defaults unknown hosts to Tier 3", () => {
    expect(classifyHostTier("www.spiegel.de")).toBe(3);
    expect(classifyHostTier("example.com")).toBe(3);
  });
});

describe("rankWebSearchResults", () => {
  it("puts Minijob-Zentrale before Facebook and drops T4 when better tiers exist", () => {
    const ranked = rankWebSearchResults(
      [
        {
          title: "Facebook Gruppe Minijob",
          url: "https://www.facebook.com/groups/minijob",
          snippet: "Leute sagen Grenze ist 600",
        },
        {
          title: "Minijob-Zentrale Verdienstgrenze",
          url: "https://www.minijob-zentrale.de/verdienstgrenze",
          snippet: "Offizielle Minijob Verdienstgrenze",
        },
        {
          title: "Reddit Diskussion",
          url: "https://www.reddit.com/r/de/minijob",
          snippet: "Meinung",
        },
      ],
      "Minijob Verdienstgrenze",
    );

    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked.length).toBeLessThanOrEqual(RANKED_RESULT_MAX);
    expect(ranked[0]?.url).toContain("minijob-zentrale.de");
    expect(ranked.every((r) => !r.url.includes("facebook.com"))).toBe(true);
    expect(ranked.every((r) => !r.url.includes("reddit.com"))).toBe(true);
    expect(ranked.every((r) => r.tier <= 3)).toBe(true);
  });

  it("returns at most 4 results (prefer 3)", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      title: `BMAS page ${i}`,
      url: `https://www.bmas.de/page-${i}`,
      snippet: "Minijob Grenze Deutschland",
    }));
    const ranked = rankWebSearchResults(many, "Minijob Grenze");
    expect(ranked.length).toBeLessThanOrEqual(RANKED_RESULT_MAX);
    expect(ranked.length).toBe(RANKED_RESULT_LIMIT);
  });

  it("prefers Tier1 over Tier3 when snippets contradict", () => {
    const ranked = rankWebSearchResults(
      [
        {
          title: "Blog: Grenze 700 Euro",
          url: "https://random-blog.example/minijob",
          snippet: "Die Minijob-Grenze beträgt 700 Euro",
        },
        {
          title: "BMAS: aktuelle Grenze",
          url: "https://www.bmas.de/minijob",
          snippet: "Die Minijob-Grenze beträgt 556 Euro",
        },
      ],
      "Minijob Grenze",
    );
    expect(ranked[0]?.url).toContain("bmas.de");
    expect(ranked[0]?.tier).toBe(1);
  });

  it("keeps Tier4 only when no better tiers exist", () => {
    const ranked = rankWebSearchResults(
      [
        {
          title: "FB",
          url: "https://www.facebook.com/x",
          snippet: "Minijob",
        },
      ],
      "Minijob",
    );
    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.tier).toBe(4);
  });
});
