import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { loadEnvFileViewsSync, loadEnvFilesSync, parseEnvText } from "./env-files.mjs";

describe("parseEnvText", () => {
  it("parses NAME=value lines, quotes, export, comments and CRLF", () => {
    const text = [
      "# comment",
      "A=1",
      "  B = two words  ",
      'C="quoted # not a comment"',
      "D='single'",
      "export E=exported",
      "F=value # trailing comment",
      "G=",
      "not a line",
      "1BAD=x",
      "",
    ].join("\r\n");
    expect(parseEnvText(text)).toEqual({
      A: "1",
      B: "two words",
      C: "quoted # not a comment",
      D: "single",
      E: "exported",
      F: "value",
      G: "",
    });
  });
});

describe("loadEnvFilesSync", () => {
  it("merges .env and .env.* in a stable order and ignores *.example and other files", () => {
    const root = mkdtempSync(join(tmpdir(), "mjc-p1-envload-"));
    try {
      writeFileSync(join(root, ".env"), "A=base\nB=base\n");
      writeFileSync(join(root, ".env.local"), "B=local\n");
      writeFileSync(join(root, ".env.production"), "C=prod\n");
      writeFileSync(join(root, ".env.example"), "A=example\nZ=example\n");
      writeFileSync(join(root, "env.txt"), "Y=nope\n");
      mkdirSync(join(root, ".env.dir"));
      expect(loadEnvFilesSync(root)).toEqual({ A: "base", B: "local", C: "prod" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("loadEnvFileViewsSync keeps one object per file (no merging) in stable order", () => {
    const root = mkdtempSync(join(tmpdir(), "mjc-p1-envviews-"));
    try {
      writeFileSync(join(root, ".env"), "A=base\n");
      writeFileSync(join(root, ".env.local"), "A=local\n");
      writeFileSync(join(root, ".env.example"), "A=example\n");
      expect(loadEnvFileViewsSync(root)).toEqual([{ A: "base" }, { A: "local" }]);
      expect(loadEnvFileViewsSync(join(tmpdir(), "mjc-p1-definitely-missing-dir"))).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("views come back in sorted name order whatever order the files were created in", () => {
    const names = [
      ".env",
      ".env.development",
      ".env.local",
      ".env.production",
      ".env.production.local",
      ".env.test",
    ];
    for (const order of [names, [...names].reverse()]) {
      const root = mkdtempSync(join(tmpdir(), "mjc-p1-envorder-"));
      try {
        for (const n of order) writeFileSync(join(root, n), `ORDER=${n}\n`);
        expect(loadEnvFileViewsSync(root).map((v) => v["ORDER"])).toEqual(names);
        expect(loadEnvFilesSync(root)).toEqual({ ORDER: ".env.test" });
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });
  it("returns an empty object for a missing directory", () => {
    expect(loadEnvFilesSync(join(tmpdir(), "mjc-p1-definitely-missing-dir"))).toEqual({});
  });
});
