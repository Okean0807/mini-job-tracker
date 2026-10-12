import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("security boundary", () => {
  const root = resolve(process.cwd());

  it("does not reintroduce SheetJS into the untrusted import path", () => {
    const importDialog = readFileSync(
      resolve(root, "src/components/minijob/ImportDialog.tsx"),
      "utf8",
    );
    expect(importDialog).not.toMatch(/import\(["']xlsx["']\)/);
    expect(importDialog).not.toMatch(/XLSX\.read/);
  });
});
