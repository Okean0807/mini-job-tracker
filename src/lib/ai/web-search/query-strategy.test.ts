import { describe, expect, it } from "vitest";

import { buildTavilyQuery } from "./query-strategy";

describe("buildTavilyQuery", () => {
  it("appends Deutschland when missing and keeps year", () => {
    const plan = buildTavilyQuery("Minijob-Grenze 2026");
    expect(plan.query).toMatch(/Deutschland/i);
    expect(plan.query).toContain("2026");
    expect(plan.includeDomains).toContain("minijob-zentrale.de");
  });

  it("picks mindestlohn preferred domains", () => {
    const plan = buildTavilyQuery("Wie hoch ist der Mindestlohn?");
    expect(plan.includeDomains).toContain("mindestlohnkommission.de");
    expect(plan.includeDomains).toContain("bmas.de");
  });

  it("picks steuer preferred domains", () => {
    const plan = buildTavilyQuery("Pauschale Lohnsteuer Minijob");
    expect(plan.includeDomains).toContain("bundesfinanzministerium.de");
  });

  it("picks SV preferred domains", () => {
    const plan = buildTavilyQuery("Sozialversicherung Beiträge Midijob");
    expect(plan.includeDomains).toContain("deutsche-rentenversicherung.de");
    expect(plan.includeDomains).toContain("gkv-spitzenverband.de");
  });
});
