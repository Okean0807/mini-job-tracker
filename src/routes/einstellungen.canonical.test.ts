import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { UI_MODES, visible } from "@/lib/minijob/uimode";

const src = join(dirname(fileURLToPath(import.meta.url)), "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return [];
    return [full];
  });
}

const files = sourceFiles(src);
const settingsRoute = readFileSync(join(src, "routes/einstellungen.tsx"), "utf8");

/**
 * One canonical Settings surface: no second implementation, no legacy route and
 * no user-type dependent variant. Registration used to return to /einstellungen
 * and leave the user there, which read as "a different Settings appeared".
 */
describe("Settings surface is canonical", () => {
  it("has exactly one settings route", () => {
    const routes = files.filter((f) => /createFileRoute\("\/einstellungen"\)/.test(readFileSync(f, "utf8")));
    expect(routes.map((f) => f.replace(src, "src"))).toEqual(["src/routes/einstellungen.tsx"]);
  });

  it("has exactly one settings page component", () => {
    const owners = files.filter((f) => readFileSync(f, "utf8").includes('t("set.tabs.general")'));
    expect(owners.map((f) => f.replace(src, "src"))).toEqual(["src/routes/einstellungen.tsx"]);
  });

  it("registers no legacy alias route", () => {
    const tree = readFileSync(join(src, "routeTree.gen.ts"), "utf8");
    const paths = new Set([...tree.matchAll(/path: '([^']+)'/g)].map((m) => m[1] ?? ""));
    expect([...paths].filter((p) => /einstellung|settings/i.test(p))).toEqual(["/einstellungen"]);
  });

  it("renders the same four tabs for everyone", () => {
    for (const key of ["general", "design", "wage", "account"]) {
      expect(settingsRoute).toContain(`t("set.tabs.${key}")`);
    }
    // No surface switch by work mode / onboarding state / demo mode.
    expect(settingsRoute).not.toMatch(/settings\.workMode/);
    expect(settingsRoute).not.toMatch(/settings\.onboarded\s*\?/);
    expect(settingsRoute).not.toMatch(/localDemoMode\s*\?\s*</);
  });

  it("keeps the settings nav item visible in every surface mode", () => {
    const root = readFileSync(join(src, "routes/__root.tsx"), "utf8");
    const navEntry = root
      .split("\n")
      .find((line) => line.includes('to: "/einstellungen"'));
    expect(navEntry).toBeDefined();
    // A `feature:` on this entry would hide Settings in simple mode.
    expect(navEntry).not.toMatch(/feature:/);
    for (const mode of UI_MODES) {
      expect(visible("settings.advanced", mode)).toBe(mode === "pro");
    }
  });

  it("only returns to Settings for a sign-in that started in Settings", () => {
    expect(settingsRoute).toMatch(/oauthRedirectTo\("\/einstellungen"\)/);
    const wizard = readFileSync(join(src, "components/minijob/OnboardingWizard.tsx"), "utf8");
    expect(wizard).toMatch(/oauthRedirectTo\("\/"\)/);
    expect(wizard).not.toMatch(/oauthRedirectTo\("\/einstellungen"\)/);
  });
});
