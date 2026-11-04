import { describe, expect, it } from "vitest";

import { loadEnvFileViewsSync, loadEnvFilesSync, type FsLike } from "./env-files.mjs";

// Deterministic precedence: the file list must be sorted no matter what order the file system
// returns (mutation finding MU44), so the listing order is injected here.
const NAMES = [".env", ".env.development", ".env.local", ".env.production", ".env.test"];
const fakeFs = (listing: string[]): FsLike => ({
  existsSync: () => true,
  readdirSync: () => [...listing],
  readFileSync: (p: string) => `ORDER=${p.split("/").pop()}\n`,
});

describe("env file order is independent of the file system listing order", () => {
  it.each([
    ["ascending", [...NAMES]],
    ["descending", [...NAMES].reverse()],
    ["shuffled", [NAMES[3], NAMES[0], NAMES[4], NAMES[1], NAMES[2]]],
  ] as [string, string[]][])("%s listing", (_label, listing) => {
    const fs = fakeFs([...listing, ".env.example", "unrelated.txt"]);
    expect(loadEnvFileViewsSync("/irrelevant", fs).map((v) => v["ORDER"])).toEqual(NAMES);
    expect(loadEnvFilesSync("/irrelevant", fs)).toEqual({ ORDER: ".env.test" });
  });

  it("a missing directory yields no views", () => {
    const fs: FsLike = { ...fakeFs([]), existsSync: () => false };
    expect(loadEnvFileViewsSync("/irrelevant", fs)).toEqual([]);
  });
});
