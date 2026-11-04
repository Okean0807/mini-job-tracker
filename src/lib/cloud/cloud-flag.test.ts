import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { validateBuildEnv } from "./build-profile.mjs";
import {
  classifyCloudFlag,
  combineCloudFlags,
  isClientCloudSyncEnabled,
  isCloudSyncEnabled,
  isServerCloudSyncEnabled,
  parseCloudFlag,
} from "./cloud-flag-runtime";

// vitest runs from the project root (CI: `bun run test`); import.meta.url is not a file URL under happy-dom.
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

/** [raw value, expected class] - 25 values (PRT-143: at least 15). */
const VALUES: [unknown, "on" | "off" | "ambiguous"][] = [
  ["true", "on"],
  ["false", "off"],
  ["", "off"],
  [undefined, "off"],
  [null, "off"],
  ["TRUE", "ambiguous"],
  ["True", "ambiguous"],
  ["tRuE", "ambiguous"],
  ["False", "ambiguous"],
  ["FALSE", "ambiguous"],
  ["1", "ambiguous"],
  ["0", "ambiguous"],
  ["yes", "ambiguous"],
  ["no", "ambiguous"],
  ["on", "ambiguous"],
  ["off", "ambiguous"],
  [" true", "ambiguous"],
  ["true ", "ambiguous"],
  [" ", "ambiguous"],
  ["\ttrue", "ambiguous"],
  ["true\n", "ambiguous"],
  ["t", "ambiguous"],
  ["truee", "ambiguous"],
  [true, "ambiguous"],
  [1, "ambiguous"],
  [{}, "ambiguous"],
];

describe("cloud flag parser (PRT-143)", () => {
  it("has at least 15 distinct inputs", () => {
    expect(VALUES.length).toBeGreaterThanOrEqual(15);
  });

  it.each(VALUES)("classifyCloudFlag(%j) -> %s", (raw, cls) => {
    expect(classifyCloudFlag(raw)).toBe(cls);
  });

  it.each(VALUES)("parseCloudFlag(%j) is true only for the exact string 'true'", (raw) => {
    expect(parseCloudFlag(raw)).toBe(raw === "true");
  });

  it("parse and classify can never disagree about ON", () => {
    for (const [raw] of VALUES) {
      expect(parseCloudFlag(raw)).toBe(classifyCloudFlag(raw) === "on");
    }
  });

  it("never throws and never normalises an ambiguous value to ON", () => {
    for (const raw of [Symbol("x"), () => "true", [], ["true"], new String("true"), NaN, 0n]) {
      expect(() => classifyCloudFlag(raw)).not.toThrow();
      expect(classifyCloudFlag(raw)).toBe("ambiguous");
      expect(parseCloudFlag(raw)).toBe(false);
    }
  });
});

describe("combined client/server decision (PRT-144, fail-closed)", () => {
  it.each([
    ["true", "true", true],
    ["true", "false", false],
    ["false", "true", false],
    ["true", undefined, false],
    [undefined, "true", false],
    [undefined, undefined, false],
    ["TRUE", "TRUE", false],
    ["1", "1", false],
    ["true", "TRUE", false],
    ["true", " true", false],
  ])("combineCloudFlags(%j, %j) -> %s", (client, server, expected) => {
    expect(combineCloudFlags(client, server)).toBe(expected);
    expect(isCloudSyncEnabled(client, server)).toBe(expected);
  });

  it("runtime accessors use the same parser", () => {
    expect(isClientCloudSyncEnabled("true")).toBe(true);
    expect(isClientCloudSyncEnabled("TRUE")).toBe(false);
    expect(isServerCloudSyncEnabled({ CLOUD_SYNC_ENABLED: "true" })).toBe(true);
    expect(isServerCloudSyncEnabled({ CLOUD_SYNC_ENABLED: "yes" })).toBe(false);
    expect(isServerCloudSyncEnabled({})).toBe(false);
  });

  it("cloud is not enabled automatically when nothing is configured (defaults are OFF)", () => {
    expect(isCloudSyncEnabled(undefined, undefined)).toBe(
      parseCloudFlag(import.meta.env["VITE_CLOUD_SYNC_ENABLED"]) &&
        parseCloudFlag(process.env["CLOUD_SYNC_ENABLED"]),
    );
    expect(isServerCloudSyncEnabled({ OTHER: "true" })).toBe(false);
  });
});

describe("build-time and runtime use ONE parser", () => {
  it.each(VALUES)("public-local verdict for %j follows the shared class", (raw, cls) => {
    const base = { MJC_BUILD_PROFILE: "public-local" };
    for (const name of ["CLOUD_SYNC_ENABLED", "VITE_CLOUD_SYNC_ENABLED"]) {
      const res = validateBuildEnv({ ...base, [name]: raw as string });
      expect(res.ok).toBe(cls === "off");
      expect(parseCloudFlag(raw)).toBe(cls === "on");
    }
  });

  it.each(VALUES)("cloud-enabled verdict for %j follows the shared class", (raw, cls) => {
    const env = {
      MJC_BUILD_PROFILE: "cloud-enabled",
      VITE_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_dummydummydummy",
      MJC_EXPECTED_SUPABASE_REF: "abcdefghijklmnopqrst",
    };
    const res = validateBuildEnv({
      ...env,
      CLOUD_SYNC_ENABLED: raw as string,
      VITE_CLOUD_SYNC_ENABLED: raw as string,
    });
    expect(res.ok).toBe(cls === "on");
  });

  it("no second implementation: build/runtime files import the shared module and do not compare flag strings", () => {
    const bp = read("src/lib/cloud/build-profile.mjs");
    expect(bp).toContain('from "./cloud-flag.mjs"');
    expect(bp).not.toMatch(/===\s*"true"/);
    expect(bp).not.toMatch(/CLOUD_FLAG_TRUE/);
    const rt = read("src/lib/cloud/cloud-flag-runtime.ts");
    expect(rt).toContain('from "./cloud-flag.mjs"');
    expect(rt).not.toMatch(/===\s*"true"/);
    const script = read("scripts/assert-build-profile.mjs");
    expect(script).toContain("build-profile.mjs");
    expect(script).not.toMatch(/CLOUD_SYNC_ENABLED/);
    const vite = read("vite.config.ts");
    expect(vite).toContain("./src/lib/cloud/build-profile.mjs");
    expect(vite).not.toMatch(/===\s*"true"/);
  });
});
