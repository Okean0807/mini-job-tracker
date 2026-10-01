import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("security boundary", () => {
  const root = resolve(process.cwd());

  it("keeps AI rate-limit state behind RLS with no client policy", () => {
    const sql = readFileSync(
      resolve(root, "supabase/migrations/20260930220000_p1_ai_rate_limit_rls.sql"),
      "utf8",
    );
    expect(sql).toMatch(/enable row level security/i);
    expect(sql).not.toMatch(/create policy/i);
  });

  it("does not reintroduce SheetJS into the untrusted import path", () => {
    const importDialog = readFileSync(
      resolve(root, "src/components/minijob/ImportDialog.tsx"),
      "utf8",
    );
    expect(importDialog).not.toMatch(/import\(["']xlsx["']\)/);
    expect(importDialog).not.toMatch(/XLSX\.read/);
  });
});
