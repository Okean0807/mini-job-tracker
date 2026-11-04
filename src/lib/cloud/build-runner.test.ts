import { spawn } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { parseBuildRunnerArgs } from "./build-runner-args.mjs";

// P1.2 - R1: an alternative Vite config must not bypass the Build Gate in the official build process.
// The official build runner (scripts/run-vite-build.mjs) runs the gate itself, pins vite.config.ts and
// refuses every argument that could select another config. Synthetic values only; slow positive builds
// are executed by the audit pipeline (evidence/builds).
const ROOT = process.cwd();
const RUNNER = resolve(ROOT, "scripts/run-vite-build.mjs");
const REF = "dummyrefmjcsentinel0";
const SENT = [`https://${REF}.supabase.co`, REF, "sb_publishable_DUMMYDUMMYDUMMYDUMMY0001"];
const TMP = mkdtempSync(join(tmpdir(), "mjc-p12-"));
const ALT = join(TMP, "alt-vite-config.mjs");
writeFileSync(ALT, "export default { build: { outDir: 'dist-alt' } };\n");

type Run = { code: number | null; out: string };
function runner(args: string[], env: Record<string, string>, cwd = ROOT): Promise<Run> {
  return new Promise((done) => {
    const child = spawn(process.execPath, [RUNNER, ...args], {
      cwd,
      env: { PATH: process.env["PATH"] ?? "", HOME: TMP, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.stderr.on("data", (d: Buffer) => (out += d.toString()));
    const timer = setTimeout(() => child.kill("SIGKILL"), 60_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      done({ code, out });
    });
  });
}
const REFUSED_ARGS = "run-vite-build: FAIL - build refused";
const noBuild = (out: string) => {
  expect(out).not.toMatch(/vite v\d/);
  expect(out).not.toContain("building");
  for (const s of SENT) expect(out).not.toContain(s);
};

describe("build runner argument policy (pure)", () => {
  it("accepts no arguments and an optional single mode in three spellings", () => {
    expect(parseBuildRunnerArgs([])).toEqual({ ok: true, mode: null });
    expect(parseBuildRunnerArgs(["--mode", "development"])).toEqual({
      ok: true,
      mode: "development",
    });
    expect(parseBuildRunnerArgs(["-m", "staging"])).toEqual({ ok: true, mode: "staging" });
    expect(parseBuildRunnerArgs(["--mode=production"])).toEqual({ ok: true, mode: "production" });
  });
  it.each([
    [["--config", "alt.mjs"]],
    [["--config=alt.mjs"]],
    [["-c", "alt.mjs"]],
    [["-c=alt.mjs"]],
    [["-calt.mjs"]],
    [["--root", "x"]],
    [["-r", "x"]],
    [["./other-dir"]],
    [["/abs/dir"]],
    [["--"]],
    [["--sourcemap"]],
    [["--mode", "development", "--config", "alt.mjs"]],
    [["--config", "alt.mjs", "--mode", "development"]],
    [["--mode", "development", "./x"]],
    [["--configLoader", "runner"]],
    [["--Config", "alt.mjs"]],
    [[""]],
  ])("refuses %j", (argv) => {
    const r = parseBuildRunnerArgs(argv);
    expect(r.ok).toBe(false);
  });
  it.each([
    [["--mode"]],
    [["-m"]],
    [["--mode", ""]],
    [["--mode="]],
    [["--mode", "../x"]],
    [["--mode", "a b"]],
    [["--mode", "x".repeat(65)]],
    [["--mode", "a", "--mode", "b"]],
    [["--mode", "a", "-m", "b"]],
    [["--mode", "--config"]],
  ])("refuses malformed or repeated mode %j", (argv) => {
    expect(parseBuildRunnerArgs(argv).ok).toBe(false);
  });
  it("is fail-closed on non-array / non-string input and never echoes the rejected value", () => {
    expect(parseBuildRunnerArgs(undefined as unknown as string[]).ok).toBe(false);
    expect(parseBuildRunnerArgs([1 as unknown as string]).ok).toBe(false);
    expect(JSON.stringify(parseBuildRunnerArgs(["--config", "SECRETVALUE"]))).not.toContain(
      "SECRETVALUE",
    );
  });
});

describe("official build runner (real process)", () => {
  it("S7: alternative config WITHOUT a profile is refused, in every spelling, before Vite starts", async () => {
    const spellings = [
      ["--config", ALT],
      [`--config=${ALT}`],
      ["-c", ALT],
      [`-c=${ALT}`],
      ["--config", ALT, "--mode", "development"],
    ];
    for (const a of spellings) {
      const r = await runner(a, {});
      expect(r.code, a.join(" ")).toBe(1);
      expect(r.out).toContain(REFUSED_ARGS);
      noBuild(r.out);
    }
    expect(existsSync(resolve(ROOT, "dist-alt"))).toBe(false);
  }, 120_000);
  it("S8: alternative config WITH a valid profile is also refused (alternative configs are not permitted in the official process)", async () => {
    for (const p of ["public-local", "cloud-enabled", "d41-pilot"]) {
      const r = await runner(["--config", ALT], { MJC_BUILD_PROFILE: p });
      expect(r.code, p).toBe(1);
      expect(r.out).toContain(REFUSED_ARGS);
      noBuild(r.out);
    }
  }, 120_000);
  it("alternative config with unknown profile / forbidden env is refused too (argument check comes first, gate would refuse as well)", async () => {
    const envs = [
      { MJC_BUILD_PROFILE: "bogus" },
      { MJC_BUILD_PROFILE: "" },
      {
        MJC_BUILD_PROFILE: "public-local",
        CLOUD_SYNC_ENABLED: "true",
        VITE_SUPABASE_URL: SENT[0] as string,
      },
    ];
    for (const env of envs) {
      const r = await runner(["--config", ALT], env);
      expect(r.code).toBe(1);
      noBuild(r.out);
    }
  }, 120_000);
  it("positional root / --root cannot select another project directory", async () => {
    for (const a of [[TMP], ["--root", TMP], ["-r", TMP]]) {
      const r = await runner(a, { MJC_BUILD_PROFILE: "public-local" });
      expect(r.code).toBe(1);
      expect(r.out).toContain(REFUSED_ARGS);
      noBuild(r.out);
    }
  }, 120_000);
  it("S1/S9/S6: no profile, mode development without profile, unknown and empty profile -> gate refuses before Vite", async () => {
    const cases: [string[], Record<string, string>][] = [
      [[], {}],
      [["--mode", "development"], {}],
      [[], { MJC_BUILD_PROFILE: "bogus" }],
      [["--mode", "development"], { MJC_BUILD_PROFILE: "bogus" }],
      [[], { MJC_BUILD_PROFILE: "" }],
    ];
    for (const [a, env] of cases) {
      const r = await runner(a, env);
      expect(r.code, JSON.stringify([a, Object.keys(env)])).toBe(1);
      expect(r.out).toContain("assert-build-profile: FAIL");
      noBuild(r.out);
    }
  }, 120_000);
  it("S12/S13: public-local with forbidden Cloud/Supabase/AI env or ambiguous flags is refused by the gate", async () => {
    const bad: Record<string, string>[] = [
      { CLOUD_SYNC_ENABLED: "true" },
      { VITE_CLOUD_SYNC_ENABLED: "true" },
      { CLOUD_SYNC_ENABLED: "TRUE" },
      { VITE_CLOUD_SYNC_ENABLED: "1" },
      { VITE_SUPABASE_URL: SENT[0] as string },
      { SUPABASE_PUBLISHABLE_KEY: SENT[2] as string },
      { GEMINI_API_KEY: "SENTINELVALUE0004" },
    ];
    for (const env of bad) {
      const r = await runner([], { MJC_BUILD_PROFILE: "public-local", ...env });
      expect(r.code, Object.keys(env).join()).toBe(1);
      expect(r.out).toContain("assert-build-profile: FAIL");
      noBuild(r.out);
    }
  }, 120_000);
  it("the runner does not depend on the caller's cwd (project root and config are derived from its own location)", async () => {
    const r = await runner([], {}, TMP);
    expect(r.code).toBe(1);
    expect(r.out).toContain("PROFILE_MISSING");
    noBuild(r.out);
  }, 60_000);
});

// A throw-away project that contains the REAL runner, gate and cloud modules but a FAKE vite binary
// (records its argv/cwd, exits with a chosen code). Proves exactly what the runner passes to Vite,
// that the gate runs first, and that Vite's exit status is propagated - without a slow real build.
function fakeProject(viteExit: number): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "mjc-p12-proj-")));
  mkdirSync(join(dir, "scripts"), { recursive: true });
  mkdirSync(join(dir, "src/lib/cloud"), { recursive: true });
  mkdirSync(join(dir, "node_modules/vite/bin"), { recursive: true });
  for (const f of ["run-vite-build.mjs", "assert-build-profile.mjs"])
    cpSync(resolve(ROOT, "scripts", f), join(dir, "scripts", f));
  for (const f of readdirSync(resolve(ROOT, "src/lib/cloud")))
    if (f.endsWith(".mjs"))
      cpSync(resolve(ROOT, "src/lib/cloud", f), join(dir, "src/lib/cloud", f));
  writeFileSync(join(dir, "vite.config.ts"), "export default {};\n");
  writeFileSync(
    join(dir, "node_modules/vite/bin/vite.js"),
    `console.log("FAKEVITE " + JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() })); process.exit(${viteExit});\n`,
  );
  return dir;
}
function runIn(dir: string, args: string[], env: Record<string, string>, cwd = dir): Promise<Run> {
  return new Promise((done) => {
    const child = spawn(process.execPath, [join(dir, "scripts/run-vite-build.mjs"), ...args], {
      cwd,
      env: { PATH: process.env["PATH"] ?? "", HOME: TMP, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.stderr.on("data", (d: Buffer) => (out += d.toString()));
    child.on("close", (code) => done({ code, out }));
  });
}
const fakeArgs = (out: string) =>
  JSON.parse(
    out
      .split("\n")
      .find((l) => l.startsWith("FAKEVITE "))!
      .slice(9),
  ) as {
    argv: string[];
    cwd: string;
  };

describe("official build runner (isolated project with a fake vite binary)", () => {
  it("valid profile: starts vite exactly as `build --config <abs vite.config.ts>` from the project root, after the gate", async () => {
    const dir = fakeProject(0);
    const r = await runIn(dir, [], { MJC_BUILD_PROFILE: "public-local" }, TMP);
    expect(r.code).toBe(0);
    expect(r.out.indexOf("assert-build-profile: OK")).toBeGreaterThan(-1);
    expect(r.out.indexOf("assert-build-profile: OK")).toBeLessThan(r.out.indexOf("FAKEVITE"));
    const a = fakeArgs(r.out);
    expect(a.argv).toEqual(["build", "--config", join(dir, "vite.config.ts")]);
    expect(a.cwd).toBe(dir);
  }, 60_000);
  it("--mode is forwarded in every spelling, and only the validated value", async () => {
    const dir = fakeProject(0);
    for (const args of [["--mode", "development"], ["-m", "development"], ["--mode=development"]]) {
      const r = await runIn(dir, args, { MJC_BUILD_PROFILE: "public-local" });
      expect(r.code).toBe(0);
      expect(fakeArgs(r.out).argv).toEqual([
        "build",
        "--config",
        join(dir, "vite.config.ts"),
        "--mode",
        "development",
      ]);
    }
  }, 60_000);
  it("any gate failure (missing/unknown profile, forbidden env) means vite is never started", async () => {
    const dir = fakeProject(0);
    for (const env of [
      {},
      { MJC_BUILD_PROFILE: "bogus" },
      { MJC_BUILD_PROFILE: "public-local", CLOUD_SYNC_ENABLED: "true" },
    ]) {
      const r = await runIn(dir, [], env);
      expect(r.code).toBe(1);
      expect(r.out).not.toContain("FAKEVITE");
    }
  }, 60_000);
  it("a refused argument means neither the gate nor vite runs; a valid profile does not change that", async () => {
    const dir = fakeProject(0);
    const r = await runIn(dir, ["--config", ALT], { MJC_BUILD_PROFILE: "public-local" });
    expect(r.code).toBe(1);
    expect(r.out).toContain(REFUSED_ARGS);
    expect(r.out).not.toContain("FAKEVITE");
    expect(r.out).not.toContain("assert-build-profile: OK");
  }, 60_000);
  it("vite's exit status is propagated (a failing build is never reported as success)", async () => {
    for (const code of [1, 7]) {
      const dir = fakeProject(code);
      const r = await runIn(dir, [], { MJC_BUILD_PROFILE: "public-local" });
      expect(r.code).toBe(code);
    }
  }, 60_000);
  it("missing vite binary or missing vite.config.ts is a hard failure (exit 1)", async () => {
    const noBin = fakeProject(0);
    rmSync(join(noBin, "node_modules/vite/bin/vite.js"));
    const r1 = await runIn(noBin, [], { MJC_BUILD_PROFILE: "public-local" });
    expect(r1.code).toBe(1);
    expect(r1.out).toContain("vite is not installed");
    const noCfg = fakeProject(0);
    rmSync(join(noCfg, "vite.config.ts"));
    const r2 = await runIn(noCfg, [], { MJC_BUILD_PROFILE: "public-local" });
    expect(r2.code).toBe(1);
    expect(r2.out).toContain("vite.config.ts not found");
  }, 60_000);
});

describe("official build runner (static)", () => {
  const src = readFileSync(RUNNER, "utf8");
  it("runs the gate before starting Vite, and pins the project's vite.config.ts by absolute path", () => {
    const gate = src.indexOf("assert-build-profile.mjs");
    const vite = src.indexOf('"build", "--config"');
    expect(gate).toBeGreaterThan(-1);
    expect(vite).toBeGreaterThan(gate);
    expect(src).toContain('resolve(root, "vite.config.ts")');
    expect(src).toContain("cwd: root");
  });
  it("forwards no user-supplied argument to Vite except the validated mode, and has no network or eval", () => {
    expect(src).not.toMatch(/spawnSync\([^)]*process\.argv/);
    expect(src.match(/process\.argv/g)).toHaveLength(1); // only the one parseBuildRunnerArgs(...) call reads the CLI args
    expect(src).not.toMatch(/\bfetch\(|node:https?|\beval\(|new Function/);
    expect(src).toContain("parseBuildRunnerArgs(process.argv.slice(2))");
  });
});
