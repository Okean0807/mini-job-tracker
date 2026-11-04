import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Exercises the real build gate (scripts/assert-build-profile.mjs) in a child process with a
// fully controlled environment. Only synthetic values; sentinels prove that nothing is echoed.
const SCRIPT = resolve(process.cwd(), "scripts/assert-build-profile.mjs");
const SHIM = resolve(process.cwd(), "scripts/assert-vite-supabase-env.mjs");
const REF = "abcdefghijklmnopqrst";
const URL_OK = `https://${REF}.supabase.co`;
const KEY_OK = "sb_publishable_SENTINELPUBKEY0001";
const SECRET = "sb_secret_SENTINELSECRET0001";
const SENTINELS = [URL_OK, REF, KEY_OK, SECRET, "SENTINELVALUE0003"];

let emptyRoot = "";
beforeAll(() => {
  emptyRoot = mkdtempSync(join(tmpdir(), "mjc-p1-gate-"));
});
afterAll(() => {
  rmSync(emptyRoot, { recursive: true, force: true });
});

type Env = Record<string, string>;
function gate(env: Env, opts: { root?: string; script?: string } = {}) {
  const r = spawnSync(process.execPath, [opts.script ?? SCRIPT, "--root", opts.root ?? emptyRoot], {
    env: { PATH: process.env["PATH"] ?? "", ...env },
    encoding: "utf8",
    timeout: 30_000,
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}`, stdout: r.stdout, stderr: r.stderr };
}
const cloud = (profile: string, extra: Env = {}): Env => ({
  MJC_BUILD_PROFILE: profile,
  CLOUD_SYNC_ENABLED: "true",
  VITE_CLOUD_SYNC_ENABLED: "true",
  VITE_SUPABASE_URL: URL_OK,
  VITE_SUPABASE_PUBLISHABLE_KEY: KEY_OK,
  MJC_EXPECTED_SUPABASE_REF: REF,
  ...(profile === "d41-pilot" ? { MJC_DENIED_SUPABASE_REFS: "zyxwvutsrqponmlkjihg" } : {}),
  ...extra,
});
function expectNoSentinels(out: string) {
  for (const s of SENTINELS) expect(out).not.toContain(s);
}

describe("build gate - public-local (PRT-001, PRT-002, PRT-003..008)", () => {
  it("PRT-002: no variables at all -> exit 0 (outside Vercel)", () => {
    const r = gate({ MJC_BUILD_PROFILE: "public-local" });
    expect(r.code).toBe(0);
    expect(r.out).toContain("profile=public-local");
  });
  it("PRT-001: VERCEL=1 without Supabase/AI variables -> exit 0", () => {
    const r = gate({ MJC_BUILD_PROFILE: "public-local", VERCEL: "1" });
    expect(r.code).toBe(0);
  });
  it.each([
    ["VITE_SUPABASE_URL", { VITE_SUPABASE_URL: URL_OK }],
    ["VITE_SUPABASE_PUBLISHABLE_KEY", { VITE_SUPABASE_PUBLISHABLE_KEY: KEY_OK }],
    ["SUPABASE_URL", { SUPABASE_URL: URL_OK }],
    ["SUPABASE_PUBLISHABLE_KEY", { SUPABASE_PUBLISHABLE_KEY: KEY_OK }],
    ["SUPABASE_SERVICE_ROLE_KEY", { SUPABASE_SERVICE_ROLE_KEY: SECRET }],
    ["GEMINI_API_KEY", { GEMINI_API_KEY: "SENTINELVALUE0003" }],
    ["GEMINI_MODEL", { GEMINI_MODEL: "SENTINELVALUE0003" }],
    ["TAVILY_API_KEY", { TAVILY_API_KEY: "SENTINELVALUE0003" }],
    ["AI_FEATURES_ENABLED", { AI_FEATURES_ENABLED: "true" }],
    ["CLOUD_SYNC_ENABLED", { CLOUD_SYNC_ENABLED: "true" }],
    ["VITE_CLOUD_SYNC_ENABLED", { VITE_CLOUD_SYNC_ENABLED: "true" }],
  ] as [string, Env][])(
    "forbidden %s with VERCEL=1 -> exit 1, name reported, no values",
    (name, extra) => {
      const r = gate({ MJC_BUILD_PROFILE: "public-local", VERCEL: "1", ...extra });
      expect(r.code).toBe(1);
      expect(r.stderr).toContain(name);
      expectNoSentinels(r.out);
    },
  );
  it("PRT-004/PRT-005: pilot values + bridge sources in a public build -> exit 1, nothing printed", () => {
    const r = gate({
      MJC_BUILD_PROFILE: "public-local",
      SUPABASE_URL: URL_OK,
      SUPABASE_PUBLISHABLE_KEY: KEY_OK,
      MJC_EXPECTED_SUPABASE_REF: REF,
    });
    expect(r.code).toBe(1);
    expectNoSentinels(r.out);
  });
  it.each(["TRUE", "True", "1", "0", "yes", "no", "on", " true", "true ", "FALSE"])(
    "ambiguous flag %j -> exit 1 (PRT-137)",
    (v) => {
      for (const name of ["CLOUD_SYNC_ENABLED", "VITE_CLOUD_SYNC_ENABLED"]) {
        const r = gate({ MJC_BUILD_PROFILE: "public-local", [name]: v });
        expect(r.code).toBe(1);
        expect(r.stderr).toContain("CLOUD_FLAG_AMBIGUOUS");
      }
    },
  );
  it.each([
    [{}, "PRT-130"],
    [{ CLOUD_SYNC_ENABLED: "false", VITE_CLOUD_SYNC_ENABLED: "false" }, "PRT-131"],
    [{ CLOUD_SYNC_ENABLED: "", VITE_CLOUD_SYNC_ENABLED: "" }, "PRT-132"],
    [{ VITE_CLOUD_SYNC_ENABLED: "false" }, "PRT-132"],
  ] as [Env, string][])("OFF flag combination %j -> exit 0 (%s)", (flags) => {
    expect(gate({ MJC_BUILD_PROFILE: "public-local", ...flags }).code).toBe(0);
  });
  it.each([
    [{ CLOUD_SYNC_ENABLED: "true" }, "PRT-133"],
    [{ VITE_CLOUD_SYNC_ENABLED: "true" }, "PRT-134"],
    [{ CLOUD_SYNC_ENABLED: "true", VITE_CLOUD_SYNC_ENABLED: "true" }, "PRT-135"],
    [{ CLOUD_SYNC_ENABLED: "true", VITE_CLOUD_SYNC_ENABLED: "false" }, "PRT-136"],
    [{ CLOUD_SYNC_ENABLED: "false", VITE_CLOUD_SYNC_ENABLED: "true" }, "PRT-136"],
  ] as [Env, string][])("ON flag combination %j -> exit 1 (%s)", (flags) => {
    expect(gate({ MJC_BUILD_PROFILE: "public-local", ...flags }).code).toBe(1);
  });
});

describe("build gate - profile selection (PRT-009)", () => {
  it.each([
    [{}],
    [{ MJC_BUILD_PROFILE: "" }],
    [{ MJC_BUILD_PROFILE: "production" }],
    [{ MJC_BUILD_PROFILE: "Public-Local" }],
    [{ VERCEL: "1" }],
  ] as [Env][])("%j -> exit 1", (env) => {
    const r = gate(env);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("MJC_BUILD_PROFILE");
  });
});

describe("build gate - cloud-enabled / d41-pilot (PRT-010, PRT-011, PRT-012, PRT-014, PRT-138..141)", () => {
  it.each(["cloud-enabled", "d41-pilot"])(
    "%s with correct synthetic values -> exit 0, no values printed (PRT-014)",
    (profile) => {
      for (const vercel of [undefined, "1"]) {
        const r = gate(cloud(profile, vercel ? { VERCEL: vercel } : {}));
        expect(r.code).toBe(0);
        expect(r.stdout).toContain(`profile=${profile}`);
        expectNoSentinels(r.out);
      }
    },
  );
  it.each(["cloud-enabled", "d41-pilot"])(
    "%s without any required value -> exit 1 (PRT-010)",
    (profile) => {
      const r = gate({ MJC_BUILD_PROFILE: profile });
      expect(r.code).toBe(1);
      expect(r.stderr).toContain("MISSING_REQUIRED_VARIABLE");
    },
  );
  it.each([
    ["VITE_SUPABASE_URL"],
    ["VITE_SUPABASE_PUBLISHABLE_KEY"],
    ["MJC_EXPECTED_SUPABASE_REF"],
  ])("cloud-enabled missing %s -> exit 1", (name) => {
    const env = cloud("cloud-enabled");
    delete env[name];
    expect(gate(env).code).toBe(1);
  });
  it("SUPABASE_* (bridge sources) satisfy the requirement as before (VERCEL=1)", () => {
    const env = cloud("cloud-enabled", { VERCEL: "1" });
    delete env["VITE_SUPABASE_URL"];
    delete env["VITE_SUPABASE_PUBLISHABLE_KEY"];
    const r = gate({ ...env, SUPABASE_URL: URL_OK, SUPABASE_PUBLISHABLE_KEY: KEY_OK });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("source=SUPABASE_URL");
  });
  it.each([
    [{ CLOUD_SYNC_ENABLED: "true", VITE_CLOUD_SYNC_ENABLED: "false" }],
    [{ CLOUD_SYNC_ENABLED: "true", VITE_CLOUD_SYNC_ENABLED: "" }],
    [{ CLOUD_SYNC_ENABLED: "false", VITE_CLOUD_SYNC_ENABLED: "false" }],
    [{ CLOUD_SYNC_ENABLED: "TRUE", VITE_CLOUD_SYNC_ENABLED: "TRUE" }],
    [{ CLOUD_SYNC_ENABLED: "1", VITE_CLOUD_SYNC_ENABLED: "1" }],
    [{ CLOUD_SYNC_ENABLED: "true", VITE_CLOUD_SYNC_ENABLED: " true" }],
  ] as [Env][])("flags %j -> exit 1 for both cloud profiles", (flags) => {
    for (const profile of ["cloud-enabled", "d41-pilot"])
      expect(gate(cloud(profile, flags)).code).toBe(1);
  });
  it("flags unset -> exit 1 (profile requires ON)", () => {
    const env = cloud("cloud-enabled");
    delete env["CLOUD_SYNC_ENABLED"];
    delete env["VITE_CLOUD_SYNC_ENABLED"];
    expect(gate(env).code).toBe(1);
  });
  it("PRT-012: ref mismatch and denied ref -> exit 1, refs not printed", () => {
    const a = gate(cloud("cloud-enabled", { MJC_EXPECTED_SUPABASE_REF: "zyxwvutsrqponmlkjihg" }));
    expect(a.code).toBe(1);
    const b = gate(cloud("d41-pilot", { MJC_DENIED_SUPABASE_REFS: REF }));
    expect(b.code).toBe(1);
    expectNoSentinels(a.out + b.out);
    expect(a.out + b.out).not.toContain("zyxwvutsrqponmlkjihg");
  });
  it("d41-pilot rejects a service role key and AI variables in the build environment", () => {
    expect(gate(cloud("d41-pilot", { SUPABASE_SERVICE_ROLE_KEY: SECRET })).code).toBe(1);
    expect(gate(cloud("d41-pilot", { GEMINI_API_KEY: "SENTINELVALUE0003" })).code).toBe(1);
  });
});

describe("build gate - secrets in public variables (PRT-013)", () => {
  it.each(["public-local", "cloud-enabled", "d41-pilot"])(
    "%s: VITE_*SECRET* name and sb_secret_ value stop the build, nothing printed",
    (profile) => {
      const base = profile === "public-local" ? { MJC_BUILD_PROFILE: profile } : cloud(profile);
      const byName = gate({ ...base, VITE_MY_SECRET: "SENTINELVALUE0003" });
      expect(byName.code).toBe(1);
      expect(byName.stderr).toContain("VITE_MY_SECRET");
      const byValue = gate({ ...base, VITE_SUPABASE_PUBLISHABLE_KEY: SECRET });
      expect(byValue.code).toBe(1);
      expectNoSentinels(byName.out + byValue.out);
    },
  );
});

describe("build gate - .env files are scanned like process.env", () => {
  function withRoot(files: Record<string, string>, fn: (root: string) => void) {
    const root = mkdtempSync(join(tmpdir(), "mjc-p1-envfiles-"));
    try {
      for (const [name, content] of Object.entries(files)) writeFileSync(join(root, name), content);
      fn(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
  it("forbidden variable only in .env -> exit 1 for public-local", () => {
    withRoot({ ".env": `VITE_SUPABASE_URL=${URL_OK}\n` }, (root) => {
      const r = gate({ MJC_BUILD_PROFILE: "public-local" }, { root });
      expect(r.code).toBe(1);
      expect(r.stderr).toContain("VITE_SUPABASE_URL");
      expectNoSentinels(r.out);
    });
  });
  it("cloud flag true only in .env.production.local -> exit 1 for public-local", () => {
    withRoot({ ".env.production.local": "VITE_CLOUD_SYNC_ENABLED=true\n" }, (root) => {
      expect(gate({ MJC_BUILD_PROFILE: "public-local" }, { root }).code).toBe(1);
    });
  });
  it("process.env wins over .env (same precedence as Vite)", () => {
    withRoot({ ".env": "VITE_CLOUD_SYNC_ENABLED=true\n" }, (root) => {
      expect(
        gate({ MJC_BUILD_PROFILE: "public-local", VITE_CLOUD_SYNC_ENABLED: "false" }, { root })
          .code,
      ).toBe(0);
    });
  });
  it(".env.example templates are ignored", () => {
    withRoot({ ".env.example": `SUPABASE_URL=${URL_OK}\nCLOUD_SYNC_ENABLED=true\n` }, (root) => {
      expect(gate({ MJC_BUILD_PROFILE: "public-local" }, { root }).code).toBe(0);
    });
  });
  it("a non-existent root is treated as no files", () => {
    expect(
      gate({ MJC_BUILD_PROFILE: "public-local" }, { root: join(emptyRoot, "does-not-exist") }).code,
    ).toBe(0);
  });
});

describe("compatibility entry points and wiring", () => {
  it("the legacy script name still works and delegates to the profile gate", () => {
    expect(gate({ MJC_BUILD_PROFILE: "public-local" }, { script: SHIM }).code).toBe(0);
    expect(gate({ VERCEL: "1" }, { script: SHIM }).code).toBe(1);
  });
  it("package.json: build runs the profile gate before vite build; no stale gate reference", () => {
    const pkg = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["build"]).toBe("node scripts/assert-build-profile.mjs && vite build");
    expect(pkg.scripts["assert:build-profile"]).toBe("node scripts/assert-build-profile.mjs");
    expect(pkg.scripts["assert:vite-supabase-env"]).toBe("node scripts/assert-build-profile.mjs");
  });
  it("vite.config.ts uses the shared validation and the profile-driven flag/bridge", () => {
    const vite = readFileSync(resolve(process.cwd(), "vite.config.ts"), "utf8");
    expect(vite).toContain("validateBuildEnv");
    expect(vite).toContain("computeViteEnvOverrides");
    expect(vite).toContain("loadEnvFilesSync");
  });
  it("the gate runs without writing anything into the cwd", () => {
    const dir = mkdtempSync(join(tmpdir(), "mjc-p1-cwd-"));
    try {
      mkdirSync(join(dir, "x"));
      const r = spawnSync(process.execPath, [SCRIPT, "--root", emptyRoot], {
        cwd: dir,
        env: { PATH: process.env["PATH"] ?? "", MJC_BUILD_PROFILE: "public-local" },
        encoding: "utf8",
      });
      expect(r.status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
