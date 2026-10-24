import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const script = resolve(process.cwd(), "scripts/assert-vite-supabase-env.mjs");
const configToml = readFileSync(resolve(process.cwd(), "supabase/config.toml"), "utf8");
const PROD_REF = /project_id\s*=\s*"([a-z0-9]+)"/.exec(configToml)![1]!;
const PREVIEW_REF = "sqbrwealracpgkkhozii";

const PROD_URL = `https://${PROD_REF}.supabase.co`;
const PREVIEW_URL = `https://${PREVIEW_REF}.supabase.co`;
// Placeholder values only — no real keys in tests.
const FAKE_KEY = "sb_publishable_FAKE_FOR_TESTS_ONLY";
const FAKE_SECRET = "FAKE_SERVER_SECRET_FOR_TESTS_ONLY";

/** Runs the real build gate with a clean environment (no inherited variables). */
function run(env: Record<string, string>) {
  const result = spawnSync(process.execPath, [script], {
    env: { PATH: process.env["PATH"] ?? "", VERCEL: "1", ...env },
    encoding: "utf8",
  });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

const previewOk = {
  VERCEL_ENV: "preview",
  VITE_SUPABASE_URL: PREVIEW_URL,
  VITE_SUPABASE_PUBLISHABLE_KEY: FAKE_KEY,
};

describe("assert-vite-supabase-env — Preview isolation gate", () => {
  it("guards against the ref that supabase/config.toml names (sanity)", () => {
    expect(PROD_REF).toMatch(/^[a-z0-9]{20}$/);
    expect(PROD_REF).not.toBe(PREVIEW_REF);
  });

  it("Preview with the Preview project and no server credentials passes", () => {
    const r = run(previewOk);
    expect(r.status).toBe(0);
    expect(r.out).toContain("Preview isolation OK");
  });

  it("Preview whose VITE_SUPABASE_URL is the Production project fails the build", () => {
    const r = run({ ...previewOk, VITE_SUPABASE_URL: PROD_URL });
    expect(r.status).toBe(1);
    expect(r.out).toContain("VITE_SUPABASE_URL points to the Production project");
  });

  it("a Production fallback variable left on Preview fails even when VITE_* is correct", () => {
    for (const [name, value] of [
      ["SUPABASE_URL", PROD_URL],
      ["SUPABASE_PROJECT_ID", PROD_REF],
      ["VITE_SUPABASE_PROJECT_ID", PROD_REF],
    ] as const) {
      const r = run({ ...previewOk, [name]: value });
      expect(r.status, name).toBe(1);
      expect(r.out, name).toContain(`${name} points to the Production project`);
    }
  });

  it("Preview fails when only the Production SUPABASE_URL fallback is set (would be bridged into VITE_*)", () => {
    const r = run({
      VERCEL_ENV: "preview",
      SUPABASE_URL: PROD_URL,
      SUPABASE_PUBLISHABLE_KEY: FAKE_KEY,
    });
    expect(r.status).toBe(1);
    expect(r.out).toContain("SUPABASE_URL points to the Production project");
  });

  it("Production-only server credentials on Preview fail the build", () => {
    for (const name of ["SUPABASE_SERVICE_ROLE_KEY", "LOVABLE_API_KEY"]) {
      const r = run({ ...previewOk, [name]: FAKE_SECRET });
      expect(r.status, name).toBe(1);
      expect(r.out, name).toContain(`${name} must not be set for Preview`);
    }
  });

  it("never prints variable values, only names", () => {
    const r = run({
      ...previewOk,
      VITE_SUPABASE_URL: PROD_URL,
      SUPABASE_SERVICE_ROLE_KEY: FAKE_SECRET,
    });
    expect(r.status).toBe(1);
    expect(r.out).not.toContain(FAKE_SECRET);
    expect(r.out).not.toContain(FAKE_KEY);
    expect(r.out).not.toContain(PROD_URL);
  });

  it("Production builds are unchanged: Production project and server credentials allowed", () => {
    const r = run({
      VERCEL_ENV: "production",
      VITE_SUPABASE_URL: PROD_URL,
      VITE_SUPABASE_PUBLISHABLE_KEY: FAKE_KEY,
      SUPABASE_SERVICE_ROLE_KEY: FAKE_SECRET,
      LOVABLE_API_KEY: FAKE_SECRET,
    });
    expect(r.status).toBe(0);
    expect(r.out).not.toContain("Preview isolation");
  });

  it("existing behaviour kept: missing URL/key still fails; non-Vercel builds skip", () => {
    expect(run({ VERCEL_ENV: "preview" }).status).toBe(1);
    const local = spawnSync(process.execPath, [script], {
      env: { PATH: process.env["PATH"] ?? "" },
      encoding: "utf8",
    });
    expect(local.status).toBe(0);
    expect(local.stdout).toContain("skip");
  });
});
