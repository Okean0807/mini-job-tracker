import { describe, expect, it } from "vitest";

import {
  BUILD_PROFILES,
  computeViteEnvOverrides,
  formatBuildProfileFailure,
  resolveViteBuildProfile,
  supabaseRefFromUrl,
  validateBuildEnv,
  validateBuildEnvAcrossViews,
} from "./build-profile.mjs";

// Synthetic values only (never real keys). Sentinels let us prove nothing is echoed back.
const REF = "abcdefghijklmnopqrst";
const OTHER_REF = "zyxwvutsrqponmlkjihg";
const URL_OK = `https://${REF}.supabase.co`;
const KEY_OK = "sb_publishable_SENTINELPUBKEY0001";
const SECRET = "sb_secret_SENTINELSECRET0001";

type Env = Record<string, string | undefined>;
const cloudEnv = (
  profile: "cloud-enabled" | "d41-pilot" = "cloud-enabled",
  extra: Env = {},
): Env => ({
  MJC_BUILD_PROFILE: profile,
  CLOUD_SYNC_ENABLED: "true",
  VITE_CLOUD_SYNC_ENABLED: "true",
  VITE_SUPABASE_URL: URL_OK,
  VITE_SUPABASE_PUBLISHABLE_KEY: KEY_OK,
  MJC_EXPECTED_SUPABASE_REF: REF,
  ...(profile === "d41-pilot" ? { MJC_DENIED_SUPABASE_REFS: `${OTHER_REF}` } : {}),
  ...extra,
});
const pub = (extra: Env = {}): Env => ({ MJC_BUILD_PROFILE: "public-local", ...extra });
const codes = (env: Env) => validateBuildEnv(env).errors.map((e) => e.code);
const namesOf = (env: Env, code: string) =>
  validateBuildEnv(env).errors.find((e) => e.code === code)?.names ?? [];

describe("profile selection (PRT-009)", () => {
  it("lists exactly the three profiles", () => {
    expect([...BUILD_PROFILES]).toEqual(["public-local", "cloud-enabled", "d41-pilot"]);
  });
  it.each([
    [{}, "PROFILE_MISSING"],
    [{ MJC_BUILD_PROFILE: "" }, "PROFILE_MISSING"],
    [{ MJC_BUILD_PROFILE: "production" }, "PROFILE_UNKNOWN"],
    [{ MJC_BUILD_PROFILE: "Public-Local" }, "PROFILE_UNKNOWN"],
    [{ MJC_BUILD_PROFILE: " public-local" }, "PROFILE_UNKNOWN"],
    [{ MJC_BUILD_PROFILE: "public-local " }, "PROFILE_UNKNOWN"],
    [{ MJC_BUILD_PROFILE: "public_local" }, "PROFILE_UNKNOWN"],
    [{ MJC_BUILD_PROFILE: "d41" }, "PROFILE_UNKNOWN"],
  ] as [Env, string][])("profile %j stops the build with %s", (env, code) => {
    const res = validateBuildEnv(env);
    expect(res.ok).toBe(false);
    expect(res.errors.map((e) => e.code)).toContain(code);
    expect(res.profile).toBeNull();
  });
});

describe("public-local: accepted configurations (PRT-001, PRT-002, PRT-130..132)", () => {
  it.each([
    ["no variables at all", {}],
    ["VERCEL=1 without Supabase variables (PRT-001)", { VERCEL: "1" }],
    ["flags unset", {}],
    [
      "flags false/false (PRT-131)",
      { CLOUD_SYNC_ENABLED: "false", VITE_CLOUD_SYNC_ENABLED: "false" },
    ],
    ["server unset, client false (PRT-132)", { VITE_CLOUD_SYNC_ENABLED: "false" }],
    ["server false, client unset (PRT-132)", { CLOUD_SYNC_ENABLED: "false" }],
    ["both empty (PRT-132)", { CLOUD_SYNC_ENABLED: "", VITE_CLOUD_SYNC_ENABLED: "" }],
    ["AI flag false", { AI_FEATURES_ENABLED: "false" }],
    ["AI flag empty", { AI_FEATURES_ENABLED: "" }],
    [
      "empty (non-secret) variables are ignored",
      { SUPABASE_URL: "", VITE_SUPABASE_URL: "  ", GEMINI_API_KEY: "" },
    ],
    ["unrelated variables", { NODE_ENV: "production", TZ: "UTC" }],
  ] as [string, Env][])("%s", (_n, extra) => {
    const res = validateBuildEnv(pub(extra));
    expect(res.errors).toEqual([]);
    expect(res.ok).toBe(true);
    expect(res.profile).toBe("public-local");
    expect(res.bridgeSupabase).toBe(false);
    expect(res.viteEnv).toEqual({ VITE_CLOUD_SYNC_ENABLED: "false" });
  });
});

describe("public-local: forbidden variables (PRT-003..PRT-007)", () => {
  it.each([
    ["VITE_SUPABASE_URL"],
    ["VITE_SUPABASE_PUBLISHABLE_KEY"],
    ["VITE_SUPABASE_PROJECT_ID"],
    ["SUPABASE_URL"],
    ["SUPABASE_PUBLISHABLE_KEY"],
    ["SUPABASE_SERVICE_ROLE_KEY"],
    ["SUPABASE_PROJECT_ID"],
    ["GEMINI_API_KEY"],
    ["GEMINI_MODEL"],
    ["TAVILY_API_KEY"],
    ["MJC_EXPECTED_SUPABASE_REF"],
    ["MJC_DENIED_SUPABASE_REFS"],
  ])("%s present -> stop, name reported, value not echoed", (name) => {
    const env = pub({ [name]: "SENTINELVALUE0001" });
    const res = validateBuildEnv(env);
    expect(res.ok).toBe(false);
    expect(namesOf(env, "FORBIDDEN_VARIABLE_FOR_PUBLIC_LOCAL")).toContain(name);
    expect(JSON.stringify(res)).not.toContain("SENTINELVALUE0001");
    expect(formatBuildProfileFailure(res).join("\n")).not.toContain("SENTINELVALUE0001");
  });

  it("pilot values in a public build are rejected (PRT-004, PRT-005 bridge)", () => {
    const env = pub({
      SUPABASE_URL: URL_OK,
      SUPABASE_PUBLISHABLE_KEY: KEY_OK,
      MJC_EXPECTED_SUPABASE_REF: REF,
    });
    const res = validateBuildEnv(env);
    expect(res.ok).toBe(false);
    expect(res.bridgeSupabase).toBe(false);
    expect(computeViteEnvOverrides(env, res)).toEqual({});
    expect(JSON.stringify(res)).not.toContain(REF);
  });

  it.each([["true"], ["TRUE"], ["1"], ["yes"], ["on"], [" true"]])(
    "AI_FEATURES_ENABLED=%j stops the build (PRT-007)",
    (v) => {
      expect(validateBuildEnv(pub({ AI_FEATURES_ENABLED: v })).ok).toBe(false);
    },
  );
});

describe("public-local: cloud flags (PRT-008, PRT-133..137, PRT-142)", () => {
  it.each([
    [{ CLOUD_SYNC_ENABLED: "true" }, "PRT-133"],
    [{ VITE_CLOUD_SYNC_ENABLED: "true" }, "PRT-134"],
    [{ CLOUD_SYNC_ENABLED: "true", VITE_CLOUD_SYNC_ENABLED: "true" }, "PRT-135"],
    [{ CLOUD_SYNC_ENABLED: "true", VITE_CLOUD_SYNC_ENABLED: "false" }, "PRT-136"],
    [{ CLOUD_SYNC_ENABLED: "false", VITE_CLOUD_SYNC_ENABLED: "true" }, "PRT-136"],
    [{ CLOUD_SYNC_ENABLED: "true", VITE_CLOUD_SYNC_ENABLED: "" }, "PRT-142"],
  ] as [Env, string][])("%j stops the build (%s)", (flags) => {
    const res = validateBuildEnv(pub(flags));
    expect(res.ok).toBe(false);
    expect(res.errors.map((e) => e.code)).toContain("CLOUD_FLAG_ON_FORBIDDEN_IN_PUBLIC_LOCAL");
  });

  it.each(["TRUE", "True", "1", "0", "yes", "no", "on", " true", "true ", " ", "FALSE", "False"])(
    "ambiguous flag value %j stops the build in either variable (PRT-137)",
    (v) => {
      for (const name of ["CLOUD_SYNC_ENABLED", "VITE_CLOUD_SYNC_ENABLED"]) {
        const res = validateBuildEnv(pub({ [name]: v }));
        expect(res.ok).toBe(false);
        expect(res.errors.find((e) => e.code === "CLOUD_FLAG_AMBIGUOUS")?.names).toEqual([name]);
      }
    },
  );

  it("no combination of the two flags can turn the cloud on in public-local", () => {
    const values = [undefined, "", "false", "true", "TRUE", "1", " true"];
    for (const a of values) {
      for (const b of values) {
        const env = pub({ CLOUD_SYNC_ENABLED: a, VITE_CLOUD_SYNC_ENABLED: b });
        const res = validateBuildEnv(env);
        if (res.ok) expect(res.viteEnv["VITE_CLOUD_SYNC_ENABLED"]).toBe("false");
        const bothOff = [a, b].every((v) => v === undefined || v === "" || v === "false");
        expect(res.ok).toBe(bothOff);
      }
    }
  });
});

describe("cloud-enabled / d41-pilot (PRT-010..PRT-014, PRT-138..141)", () => {
  it.each(["cloud-enabled", "d41-pilot"] as const)(
    "%s with correct synthetic values passes (PRT-014, PRT-138)",
    (profile) => {
      const env = cloudEnv(profile);
      const res = validateBuildEnv(env);
      expect(res.errors).toEqual([]);
      expect(res.ok).toBe(true);
      expect(res.bridgeSupabase).toBe(true);
      expect(res.viteEnv).toEqual({ VITE_CLOUD_SYNC_ENABLED: "true" });
      expect(JSON.stringify(res)).not.toContain(KEY_OK);
      expect(JSON.stringify(res)).not.toContain(REF);
    },
  );

  it("SUPABASE_* alone is enough and is bridged to VITE_* (as before)", () => {
    const env = cloudEnv("cloud-enabled", {
      VITE_SUPABASE_URL: undefined,
      VITE_SUPABASE_PUBLISHABLE_KEY: undefined,
      SUPABASE_URL: URL_OK,
      SUPABASE_PUBLISHABLE_KEY: KEY_OK,
    });
    const res = validateBuildEnv(env);
    expect(res.ok).toBe(true);
    expect(computeViteEnvOverrides(env, res)).toEqual({
      VITE_CLOUD_SYNC_ENABLED: "true",
      VITE_SUPABASE_URL: URL_OK,
      VITE_SUPABASE_PUBLISHABLE_KEY: KEY_OK,
    });
  });

  it("an existing non-empty VITE_* value is never overwritten by the bridge", () => {
    const env = cloudEnv("cloud-enabled", {
      SUPABASE_URL: URL_OK,
      SUPABASE_PUBLISHABLE_KEY: KEY_OK,
    });
    expect(computeViteEnvOverrides(env, validateBuildEnv(env))).toEqual({
      VITE_CLOUD_SYNC_ENABLED: "true",
    });
  });

  it.each([
    ["VITE_SUPABASE_URL", "VITE_SUPABASE_URL or SUPABASE_URL"],
    ["VITE_SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_PUBLISHABLE_KEY or SUPABASE_PUBLISHABLE_KEY"],
    ["MJC_EXPECTED_SUPABASE_REF", "MJC_EXPECTED_SUPABASE_REF"],
  ])("missing %s stops cloud-enabled (PRT-010)", (name, label) => {
    const env = cloudEnv("cloud-enabled", { [name]: undefined });
    expect(namesOf(env, "MISSING_REQUIRED_VARIABLE")).toContain(label);
    expect(validateBuildEnv(env).ok).toBe(false);
  });

  it("d41-pilot requires the denied-ref list (Production ref guard cannot be skipped)", () => {
    const env = cloudEnv("d41-pilot", { MJC_DENIED_SUPABASE_REFS: undefined });
    expect(namesOf(env, "MISSING_REQUIRED_VARIABLE")).toContain("MJC_DENIED_SUPABASE_REFS");
  });

  it("empty cloud profile environment fails with every required name", () => {
    const res = validateBuildEnv({ MJC_BUILD_PROFILE: "cloud-enabled" });
    expect(res.ok).toBe(false);
    expect(codes({ MJC_BUILD_PROFILE: "cloud-enabled" })).toEqual(
      expect.arrayContaining(["CLOUD_FLAG_NOT_ON", "MISSING_REQUIRED_VARIABLE"]),
    );
  });

  it.each([
    [{ CLOUD_SYNC_ENABLED: "true", VITE_CLOUD_SYNC_ENABLED: "false" }, "CLOUD_FLAG_CLASS_MISMATCH"],
    [
      { CLOUD_SYNC_ENABLED: "true", VITE_CLOUD_SYNC_ENABLED: undefined },
      "CLOUD_FLAG_CLASS_MISMATCH",
    ],
    [
      { CLOUD_SYNC_ENABLED: undefined, VITE_CLOUD_SYNC_ENABLED: "true" },
      "CLOUD_FLAG_CLASS_MISMATCH",
    ],
    [{ CLOUD_SYNC_ENABLED: "TRUE", VITE_CLOUD_SYNC_ENABLED: "TRUE" }, "CLOUD_FLAG_AMBIGUOUS"],
    [{ CLOUD_SYNC_ENABLED: "1", VITE_CLOUD_SYNC_ENABLED: "1" }, "CLOUD_FLAG_AMBIGUOUS"],
    [{ CLOUD_SYNC_ENABLED: "true", VITE_CLOUD_SYNC_ENABLED: "yes" }, "CLOUD_FLAG_AMBIGUOUS"],
    [{ CLOUD_SYNC_ENABLED: "false", VITE_CLOUD_SYNC_ENABLED: "false" }, "CLOUD_FLAG_NOT_ON"],
    [{ CLOUD_SYNC_ENABLED: undefined, VITE_CLOUD_SYNC_ENABLED: undefined }, "CLOUD_FLAG_NOT_ON"],
    [{ CLOUD_SYNC_ENABLED: "", VITE_CLOUD_SYNC_ENABLED: "" }, "CLOUD_FLAG_NOT_ON"],
  ] as [Env, string][])(
    "flags %j stop the cloud profile with %s (PRT-011, PRT-139..141)",
    (flags, code) => {
      for (const profile of ["cloud-enabled", "d41-pilot"] as const) {
        const env = cloudEnv(profile, flags);
        expect(validateBuildEnv(env).ok).toBe(false);
        expect(codes(env)).toContain(code);
      }
    },
  );

  it("ref checks (PRT-012): mismatch, undeterminable URL, denied ref, invalid expected ref", () => {
    expect(codes(cloudEnv("cloud-enabled", { MJC_EXPECTED_SUPABASE_REF: OTHER_REF }))).toContain(
      "SUPABASE_REF_MISMATCH",
    );
    expect(
      codes(cloudEnv("cloud-enabled", { VITE_SUPABASE_URL: "https://example.com" })),
    ).toContain("SUPABASE_URL_REF_UNDETERMINED");
    expect(
      codes(cloudEnv("cloud-enabled", { VITE_SUPABASE_URL: `http://${REF}.supabase.co` })),
    ).toContain("SUPABASE_URL_REF_UNDETERMINED");
    expect(codes(cloudEnv("cloud-enabled", { VITE_SUPABASE_URL: "not a url" }))).toContain(
      "SUPABASE_URL_REF_UNDETERMINED",
    );
    expect(
      codes(cloudEnv("d41-pilot", { MJC_DENIED_SUPABASE_REFS: `${OTHER_REF}, ${REF}` })),
    ).toContain("SUPABASE_REF_DENIED");
    expect(
      codes(cloudEnv("d41-pilot", { MJC_DENIED_SUPABASE_REFS: ` ${REF.toUpperCase()} ` })),
    ).toContain("SUPABASE_REF_DENIED");
    expect(codes(cloudEnv("cloud-enabled", { MJC_EXPECTED_SUPABASE_REF: "NOT-A-REF!" }))).toContain(
      "EXPECTED_REF_INVALID",
    );
    // SUPABASE_URL (bridge source) pointing elsewhere than VITE_SUPABASE_URL is also checked
    expect(
      codes(cloudEnv("cloud-enabled", { SUPABASE_URL: `https://${OTHER_REF}.supabase.co` })),
    ).toContain("SUPABASE_REF_MISMATCH");
  });

  it("d41-pilot: service role key and AI variables are forbidden in the build environment", () => {
    expect(codes(cloudEnv("d41-pilot", { SUPABASE_SERVICE_ROLE_KEY: "x" }))).toContain(
      "SERVICE_ROLE_FORBIDDEN_IN_PILOT_BUILD",
    );
    expect(codes(cloudEnv("d41-pilot", { GEMINI_API_KEY: "x" }))).toContain(
      "AI_VARIABLE_FORBIDDEN_IN_PILOT",
    );
    expect(codes(cloudEnv("d41-pilot", { TAVILY_API_KEY: "x" }))).toContain(
      "AI_VARIABLE_FORBIDDEN_IN_PILOT",
    );
    expect(codes(cloudEnv("d41-pilot", { AI_FEATURES_ENABLED: "true" }))).toContain(
      "AI_ENABLED_FORBIDDEN_IN_PILOT",
    );
    expect(codes(cloudEnv("cloud-enabled", { SUPABASE_SERVICE_ROLE_KEY: "x" }))).toEqual([]);
  });
});

describe("secrets in public variables (PRT-013, all profiles)", () => {
  const jwt = (role: string) =>
    `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.signaturesignature`;

  it.each(["public-local", "cloud-enabled", "d41-pilot"] as const)(
    "VITE_*SECRET* / *SERVICE_ROLE* / *API_KEY* names stop the %s build",
    (profile) => {
      const base = profile === "public-local" ? pub() : cloudEnv(profile);
      for (const name of [
        "VITE_SERVICE_ROLE_KEY",
        "VITE_MY_SECRET",
        "VITE_PRIVATE_THING",
        "VITE_SOME_API_KEY",
      ]) {
        const env = { ...base, [name]: "SENTINELVALUE0002" };
        const res = validateBuildEnv(env);
        expect(res.ok).toBe(false);
        expect(namesOf(env, "SECRET_IN_PUBLIC_VARIABLE_NAME")).toContain(name);
        expect(JSON.stringify(res)).not.toContain("SENTINELVALUE0002");
      }
    },
  );

  it.each(["public-local", "cloud-enabled", "d41-pilot"] as const)(
    "sb_secret_ value in a public variable stops the %s build",
    (profile) => {
      const base = profile === "public-local" ? pub() : cloudEnv(profile);
      for (const name of [
        "VITE_ANYTHING",
        "VITE_SUPABASE_PUBLISHABLE_KEY",
        "SUPABASE_PUBLISHABLE_KEY",
      ]) {
        const env = { ...base, [name]: SECRET };
        const res = validateBuildEnv(env);
        expect(res.ok).toBe(false);
        expect(namesOf(env, "SECRET_VALUE_IN_PUBLIC_VARIABLE")).toContain(name);
        expect(JSON.stringify(res)).not.toContain(SECRET);
      }
    },
  );

  it("a JWT whose payload has role service_role is rejected; an anon JWT is not", () => {
    expect(
      codes(cloudEnv("cloud-enabled", { VITE_SUPABASE_PUBLISHABLE_KEY: jwt("service_role") })),
    ).toContain("SECRET_VALUE_IN_PUBLIC_VARIABLE");
    expect(
      validateBuildEnv(cloudEnv("cloud-enabled", { VITE_SUPABASE_PUBLISHABLE_KEY: jwt("anon") }))
        .ok,
    ).toBe(true);
    expect(
      validateBuildEnv(
        cloudEnv("cloud-enabled", { VITE_SUPABASE_PUBLISHABLE_KEY: "eyJbroken.notbase64!.x" }),
      ).ok,
    ).toBe(true);
  });
});

describe("helpers", () => {
  it.each([
    [`https://${REF}.supabase.co`, REF],
    [`https://${REF}.supabase.co/`, REF],
    [`  https://${REF}.SUPABASE.CO  `, REF],
    [`http://${REF}.supabase.co`, null],
    ["https://supabase.co", null],
    ["https://a.supabase.co", null],
    ["https://example.com", null],
    ["", null],
    ["garbage", null],
  ])("supabaseRefFromUrl(%j) -> %j", (url, ref) => {
    expect(supabaseRefFromUrl(url)).toBe(ref);
  });

  it("computeViteEnvOverrides returns nothing for an invalid result", () => {
    const env = pub({ CLOUD_SYNC_ENABLED: "true" });
    expect(computeViteEnvOverrides(env, validateBuildEnv(env))).toEqual({});
  });

  it("failure text contains codes and names only", () => {
    const env = pub({
      VITE_SUPABASE_URL: URL_OK,
      SUPABASE_SERVICE_ROLE_KEY: SECRET,
      CLOUD_SYNC_ENABLED: "true",
    });
    const text = formatBuildProfileFailure(validateBuildEnv(env)).join("\n");
    for (const forbidden of [URL_OK, SECRET, REF]) expect(text).not.toContain(forbidden);
    expect(text).toContain("VITE_SUPABASE_URL");
    expect(text).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(text).toContain("CLOUD_SYNC_ENABLED");
  });

  it("is a pure function: the input object is not modified", () => {
    const env = cloudEnv("cloud-enabled");
    const snapshot = JSON.stringify(env);
    validateBuildEnv(env);
    expect(JSON.stringify(env)).toBe(snapshot);
  });
});

describe("validateBuildEnvAcrossViews (AF-1)", () => {
  it("process.env wins over a file; every file must still be clean for public-local", () => {
    expect(
      validateBuildEnvAcrossViews(pub({ VITE_CLOUD_SYNC_ENABLED: "false" }), [
        { VITE_CLOUD_SYNC_ENABLED: "true" },
      ]).ok,
    ).toBe(true);
    expect(
      validateBuildEnvAcrossViews(pub(), [
        { VITE_CLOUD_SYNC_ENABLED: "true" },
        { VITE_CLOUD_SYNC_ENABLED: "false" },
      ]).ok,
    ).toBe(false);
    expect(
      validateBuildEnvAcrossViews(pub(), [{ SUPABASE_URL: URL_OK }, { SUPABASE_URL: "" }]).ok,
    ).toBe(false);
  });
  it("a profile defined in a file applies to every view; cloud profiles use the merged view only", () => {
    expect(
      validateBuildEnvAcrossViews({}, [
        { MJC_BUILD_PROFILE: "public-local" },
        { VITE_SUPABASE_URL: URL_OK },
      ]).ok,
    ).toBe(false);
    const cloudFiles = [{ VITE_SUPABASE_URL: URL_OK }, { VITE_SUPABASE_PUBLISHABLE_KEY: KEY_OK }];
    const env = {
      MJC_BUILD_PROFILE: "cloud-enabled",
      CLOUD_SYNC_ENABLED: "true",
      VITE_CLOUD_SYNC_ENABLED: "true",
      MJC_EXPECTED_SUPABASE_REF: REF,
    };
    expect(validateBuildEnvAcrossViews(env, cloudFiles).ok).toBe(true);
  });
  it("never echoes values", () => {
    const res = validateBuildEnvAcrossViews(pub(), [
      { VITE_SUPABASE_URL: URL_OK, VITE_X_SECRET: SECRET },
    ]);
    expect(res.ok).toBe(false);
    expect(JSON.stringify(res)).not.toContain(URL_OK);
    expect(JSON.stringify(res)).not.toContain(SECRET);
  });
});

describe("resolveViteBuildProfile (vite.config.ts decision)", () => {
  it("no profile anywhere -> legacy mode (editor dev server keeps working, nothing enforced)", () => {
    expect(resolveViteBuildProfile({}, [])).toEqual({ kind: "legacy" });
    expect(resolveViteBuildProfile({ MJC_BUILD_PROFILE: "" }, [{ MJC_BUILD_PROFILE: "" }])).toEqual(
      { kind: "legacy" },
    );
    expect(resolveViteBuildProfile({ MJC_BUILD_PROFILE: "   " }, [])).toEqual({ kind: "legacy" });
    expect(
      resolveViteBuildProfile({ SUPABASE_URL: URL_OK, CLOUD_SYNC_ENABLED: "true" }, []),
    ).toEqual({ kind: "legacy" });
  });
  it("public-local: overrides force the baked flag to false and never bridge", () => {
    expect(resolveViteBuildProfile(pub(), [])).toEqual({
      kind: "profile",
      profile: "public-local",
      overrides: { VITE_CLOUD_SYNC_ENABLED: "false" },
    });
    expect(resolveViteBuildProfile({}, [{ MJC_BUILD_PROFILE: "public-local" }]).kind).toBe(
      "profile",
    );
  });
  it("cloud profile: flag true plus the SUPABASE_* bridge", () => {
    const env = cloudEnv("cloud-enabled", {
      VITE_SUPABASE_URL: undefined,
      VITE_SUPABASE_PUBLISHABLE_KEY: undefined,
      SUPABASE_URL: URL_OK,
      SUPABASE_PUBLISHABLE_KEY: KEY_OK,
    });
    const d = resolveViteBuildProfile(env, []);
    expect(d).toEqual({
      kind: "profile",
      profile: "cloud-enabled",
      overrides: {
        VITE_CLOUD_SYNC_ENABLED: "true",
        VITE_SUPABASE_URL: URL_OK,
        VITE_SUPABASE_PUBLISHABLE_KEY: KEY_OK,
      },
    });
  });
  it.each([
    [pub({ CLOUD_SYNC_ENABLED: "true" })],
    [pub({ VITE_SUPABASE_URL: URL_OK })],
    [{ MJC_BUILD_PROFILE: "bogus" }],
    [{ MJC_BUILD_PROFILE: " public-local" }],
    [cloudEnv("cloud-enabled", { VITE_CLOUD_SYNC_ENABLED: "false" })],
    [cloudEnv("d41-pilot", { MJC_DENIED_SUPABASE_REFS: REF })],
  ] as Env[][])("an invalid explicit configuration throws with names only: %j", (env) => {
    expect(() => resolveViteBuildProfile(env, [])).toThrowError(
      /build profile check failed \(names only\)/,
    );
    try {
      resolveViteBuildProfile(env, []);
    } catch (e) {
      const msg = String((e as Error).message);
      for (const v of [URL_OK, KEY_OK, SECRET, REF]) expect(msg).not.toContain(v);
    }
  });
  it("a risky .env file view throws for public-local even though process.env is clean", () => {
    expect(() => resolveViteBuildProfile(pub(), [{ VITE_CLOUD_SYNC_ENABLED: "true" }])).toThrow();
  });
});
