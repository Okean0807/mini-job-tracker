import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { enforceProfileForViteCommand } from "./build-profile.mjs";

// P1.1 - Build Gate bypass regression tests.
// These tests start the REAL commands (vite CLI, npm scripts, Vite's own config resolution) with a
// fully controlled environment and check exit codes. Only synthetic values; sentinels prove that no
// value is echoed. Slow positive builds are NOT run here: the three profile builds are executed
// by the audit pipeline (evidence/builds); here "build" success is shown by resolving the real
// vite.config.ts for command=build (plugin `config` hook included).
const ROOT = process.cwd(); // vitest runs from the project root (import.meta.url is not a file URL under happy-dom)
const VITE = resolve(ROOT, "node_modules/.bin/vite");
const REF = "dummyrefmjcsentinel0";
const URL_OK = `https://${REF}.supabase.co`;
const KEY_OK = "sb_publishable_DUMMYDUMMYDUMMYDUMMY0001";
const SENTINELS = [URL_OK, REF, KEY_OK, "SENTINELVALUE0004"];
const HOME = tmpdir();

type Env = Record<string, string>;
type Run = { code: number | null; out: string };

function exec(cmd: string, args: string[], env: Env): Promise<Run> {
  return new Promise((done) => {
    const child = spawn(cmd, args, {
      cwd: ROOT,
      env: { PATH: process.env["PATH"] ?? "", HOME, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.stderr.on("data", (d: Buffer) => (out += d.toString()));
    const timer = setTimeout(() => child.kill("SIGKILL"), 110_000);
    child.on("error", (e) => {
      clearTimeout(timer);
      done({ code: -1, out: `spawn error: ${e.message}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      done({ code, out });
    });
  });
}
/** Runs async jobs with limited concurrency (keeps CPU bursts small for the rest of the suite). */
async function pool<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const res: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        res[i] = await fn(items[i] as T);
      }
    }),
  );
  return res;
}
const vite = (args: string[], env: Env) => exec(VITE, args, env);
const noLeak = (out: string) => {
  for (const s of SENTINELS) expect(out).not.toContain(s);
};
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

/** Resolves the real vite.config.ts through Vite itself (config hooks run); prints the baked flag. */
const RESOLVE_SCRIPT = `
const { resolveConfig } = await import("vite");
const command = process.argv[1];
try {
  await resolveConfig({ root: process.cwd() }, command, command === "build" ? process.argv[2] : "development");
  console.log("RESOLVED flag=" + String(process.env.VITE_CLOUD_SYNC_ENABLED));
} catch (e) {
  console.error("REFUSED: " + String(e && e.message).slice(0, 400));
  process.exit(3);
}`;
const resolveCfg = (command: "serve" | "build", mode: string, env: Env) =>
  exec(process.execPath, ["--input-type=module", "-e", RESOLVE_SCRIPT, command, mode], env);

const npmProbe = await exec("npm", ["--version"], {});
const npmOk = npmProbe.code === 0;

describe("Build Gate bypass - scenario 1: dev server without a profile keeps working", () => {
  it("S1: Vite resolves vite.config.ts for command=serve without MJC_BUILD_PROFILE (exit 0)", async () => {
    const r = await resolveCfg("serve", "development", {});
    expect(r.code).toBe(0);
    expect(r.out).toContain("RESOLVED");
  }, 120_000);
  it("S1b: serve with a valid explicit profile also resolves; an invalid explicit profile is refused even for serve", async () => {
    const ok = await resolveCfg("serve", "development", { MJC_BUILD_PROFILE: "public-local" });
    expect(ok.code).toBe(0);
    const bad = await resolveCfg("serve", "development", {
      MJC_BUILD_PROFILE: "public-local",
      CLOUD_SYNC_ENABLED: "true",
    });
    expect(bad.code).toBe(3);
  }, 120_000);
});

describe("Build Gate bypass - scenarios 2, 3, 10: direct vite build without a profile is refused", () => {
  const modes: (string | null)[] = [
    null,
    "development",
    "production",
    "staging",
    "test",
    "preview",
  ];
  it("S2/S3: `vite build [--mode X]` without MJC_BUILD_PROFILE exits 1 in every mode and prints no values", async () => {
    const runs = await pool(modes, 4, (m) => vite(m ? ["build", "--mode", m] : ["build"], {}));
    runs.forEach((r, i) => {
      expect(r.code, `mode=${modes[i]}`).toBe(1);
      expect(r.out).toContain("requires MJC_BUILD_PROFILE");
      noLeak(r.out);
    });
  }, 120_000);
  it("S10: empty / whitespace-only profile counts as missing for builds", async () => {
    const runs = await pool(["", "   "], 2, (v) => vite(["build"], { MJC_BUILD_PROFILE: v }));
    runs.forEach((r) => {
      expect(r.code).toBe(1);
      expect(r.out).toMatch(/requires MJC_BUILD_PROFILE|PROFILE|build profile check failed/);
    });
  }, 120_000);
  it("S2: even a build with Supabase values but no profile is refused (no legacy fallback)", async () => {
    const r = await vite(["build"], {
      VERCEL: "1",
      SUPABASE_URL: URL_OK,
      SUPABASE_PUBLISHABLE_KEY: KEY_OK,
    });
    expect(r.code).toBe(1);
    expect(r.out).toContain("requires MJC_BUILD_PROFILE");
    noLeak(r.out);
  }, 120_000);
  it("an unknown Vite command is refused by the same rule (only serve may skip the profile)", () => {
    for (const command of ["build", "optimize", "", undefined, null, 42, "SERVE"]) {
      expect(() => enforceProfileForViteCommand({ kind: "legacy" }, command)).toThrow(
        /requires MJC_BUILD_PROFILE/,
      );
    }
    expect(() => enforceProfileForViteCommand({ kind: "legacy" }, "serve")).not.toThrow();
    expect(() =>
      enforceProfileForViteCommand(
        { kind: "profile", profile: "public-local", overrides: {} },
        "build",
      ),
    ).not.toThrow();
  });
});

describe("Build Gate bypass - scenarios 9, 11, 12: invalid profiles / env are refused by a direct vite build", () => {
  const cases: [string, Env][] = [
    ["unknown profile", { MJC_BUILD_PROFILE: "bogus" }],
    ["profile with different case", { MJC_BUILD_PROFILE: "Public-Local" }],
    ["profile with trailing space", { MJC_BUILD_PROFILE: "public-local " }],
    [
      "public-local + VITE_SUPABASE_URL",
      { MJC_BUILD_PROFILE: "public-local", VITE_SUPABASE_URL: URL_OK },
    ],
    [
      "public-local + SUPABASE_URL + key",
      { MJC_BUILD_PROFILE: "public-local", SUPABASE_URL: URL_OK, SUPABASE_PUBLISHABLE_KEY: KEY_OK },
    ],
    [
      "public-local + GEMINI_API_KEY",
      { MJC_BUILD_PROFILE: "public-local", GEMINI_API_KEY: "SENTINELVALUE0004" },
    ],
    [
      "public-local + AI_FEATURES_ENABLED=true",
      { MJC_BUILD_PROFILE: "public-local", AI_FEATURES_ENABLED: "true" },
    ],
    [
      "public-local + CLOUD_SYNC_ENABLED=true",
      { MJC_BUILD_PROFILE: "public-local", CLOUD_SYNC_ENABLED: "true" },
    ],
    [
      "public-local + VITE_CLOUD_SYNC_ENABLED=true",
      { MJC_BUILD_PROFILE: "public-local", VITE_CLOUD_SYNC_ENABLED: "true" },
    ],
    ["public-local + flag TRUE", { MJC_BUILD_PROFILE: "public-local", CLOUD_SYNC_ENABLED: "TRUE" }],
    ["public-local + flag 1", { MJC_BUILD_PROFILE: "public-local", VITE_CLOUD_SYNC_ENABLED: "1" }],
    [
      "public-local + flag ' true'",
      { MJC_BUILD_PROFILE: "public-local", CLOUD_SYNC_ENABLED: " true" },
    ],
    [
      "public-local + flag yes",
      { MJC_BUILD_PROFILE: "public-local", VITE_CLOUD_SYNC_ENABLED: "yes" },
    ],
    ["cloud-enabled without Supabase URL", cloud("cloud-enabled", { VITE_SUPABASE_URL: "" })],
    ["cloud-enabled flags mismatch", cloud("cloud-enabled", { VITE_CLOUD_SYNC_ENABLED: "false" })],
    [
      "cloud-enabled ambiguous flags",
      cloud("cloud-enabled", { CLOUD_SYNC_ENABLED: "TRUE", VITE_CLOUD_SYNC_ENABLED: "TRUE" }),
    ],
    ["d41-pilot without denied-ref list", cloud("d41-pilot", { MJC_DENIED_SUPABASE_REFS: "" })],
    [
      "public-local + sb_secret_ in a VITE variable",
      { MJC_BUILD_PROFILE: "public-local", VITE_X: "sb_secret_SENTINELVALUE0004SENTINEL" },
    ],
  ];
  it("every case exits 1 with a names-only message and no value in the output", async () => {
    const runs = await pool(cases, 4, ([, env]) => vite(["build"], env));
    runs.forEach((r, i) => {
      expect(r.code, cases[i]?.[0]).toBe(1);
      expect(r.out).toContain("build profile check failed");
      noLeak(r.out);
      expect(r.out).not.toContain("sb_secret_SENTINELVALUE0004SENTINEL");
    });
  }, 120_000);
  it("the same invalid cases are refused for `vite build --mode development` (no mode-based bypass)", async () => {
    const sample = cases.slice(0, 8);
    const runs = await pool(sample, 4, ([, env]) => vite(["build", "--mode", "development"], env));
    runs.forEach((r, i) => {
      expect(r.code, sample[i]?.[0]).toBe(1);
      noLeak(r.out);
    });
  }, 120_000);
});

describe("Build Gate bypass - scenarios 6, 7, 8: valid profiles pass the real config for command=build", () => {
  it.each([
    ["public-local", { MJC_BUILD_PROFILE: "public-local", VERCEL: "1" }, "false"],
    ["cloud-enabled", cloud("cloud-enabled", { VERCEL: "1" }), "true"],
    ["d41-pilot", cloud("d41-pilot", { VERCEL: "1" }), "true"],
  ] as [string, Env, string][])(
    "%s: config resolves for build (exit 0) and bakes VITE_CLOUD_SYNC_ENABLED=%s",
    async (_p, env, flag) => {
      for (const mode of ["production", "development"]) {
        const r = await resolveCfg("build", mode, env);
        expect(r.code, `${_p} ${mode}`).toBe(0);
        expect(r.out).toContain(`RESOLVED flag=${flag}`);
        noLeak(r.out);
      }
    },
    120_000,
  );
  it("build without a profile is refused by the real config resolution as well", async () => {
    const r = await resolveCfg("build", "production", {});
    expect(r.code).toBe(3);
    expect(r.out).toContain("requires MJC_BUILD_PROFILE");
  }, 120_000);
  it("full production builds of the three profiles are executed by the audit pipeline (evidence/builds), not in this fast suite", () => {
    expect(existsSync(VITE)).toBe(true);
  });
});

describe("Build Gate bypass - scenarios 4, 5: npm scripts", () => {
  const maybe = npmOk ? it : it.skip; // reported as skipped (NOT RUN) when npm is unavailable
  maybe(
    "S4/S5: `npm run build` and `npm run build:dev` without a profile exit non-zero with PROFILE_MISSING",
    async () => {
      const runs = await pool(["build", "build:dev"], 2, (s) => exec("npm", ["run", s], {}));
      runs.forEach((r) => {
        expect(r.code).not.toBe(0);
        expect(r.out).toContain("PROFILE_MISSING");
        expect(r.out).not.toMatch(/vite v\d/);
      });
    },
    120_000,
  );
  maybe(
    "`npm run build` / `build:dev` with an unknown profile or forbidden env exit non-zero",
    async () => {
      const envs: Env[] = [
        { MJC_BUILD_PROFILE: "bogus" },
        {
          MJC_BUILD_PROFILE: "public-local",
          VITE_SUPABASE_URL: URL_OK,
          CLOUD_SYNC_ENABLED: "true",
        },
      ];
      const jobs = envs.flatMap((env) => ["build", "build:dev"].map((s) => ({ env, s })));
      const runs = await pool(jobs, 4, ({ env, s }) => exec("npm", ["run", s], env));
      runs.forEach((r) => {
        expect(r.code).not.toBe(0);
        expect(r.out).not.toMatch(/vite v\d/);
        noLeak(r.out);
      });
    },
    120_000,
  );
});

describe("Build Gate bypass - script inventory (static)", () => {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  const GATE = "node scripts/assert-build-profile.mjs && ";
  it("every script that runs `vite build` runs the profile gate first", () => {
    const offenders = Object.entries(pkg.scripts).filter(
      ([, v]) => /\bvite\s+build\b/.test(v) && !v.startsWith(GATE),
    );
    expect(offenders).toEqual([]);
    expect(pkg.scripts["build"]).toBe(`${GATE}vite build`);
    expect(pkg.scripts["build:dev"]).toBe(`${GATE}vite build --mode development`);
  });
  it("the only other Vite entry points are the dev server and preview (serve commands)", () => {
    const seen: string[] = [];
    for (const [name, v] of Object.entries(pkg.scripts)) {
      for (const m of v.matchAll(/(?<![\w./-])vite(?![\w-])(?:\s+(\S+))?/g)) {
        const sub = m[1] ?? "";
        seen.push(`${name}: vite ${sub}`.trim());
        expect(["dev", "preview", "build"], `script ${name}: vite ${sub}`).toContain(sub);
      }
    }
    expect(seen.sort()).toEqual(
      [
        "build: vite build",
        "build:dev: vite build",
        "dev: vite dev",
        "preview: vite preview",
      ].sort(),
    );
  });
  it("the Vite config registers the command-aware gate as a plugin", () => {
    const cfg = readFileSync(resolve(ROOT, "vite.config.ts"), "utf8");
    expect(cfg).toContain("enforceProfileForViteCommand(profileDecision, env.command)");
    expect(cfg).toContain("buildProfileGate,");
    expect(cfg).toContain('enforce: "pre"');
  });
});
