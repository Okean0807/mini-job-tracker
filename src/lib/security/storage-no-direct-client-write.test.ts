import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// PENDING migration content check only. Passing this test does NOT mean the
// policies are dropped in production.
const root = process.cwd();
const sql = readFileSync(
  resolve(root, "supabase/pending/20261012160000_p2_documents_no_direct_client_write.sql"),
  "utf8",
);

describe("PENDING: documents bucket has no direct client write policy", () => {
  it("drops exactly the INSERT and UPDATE policies and creates nothing", () => {
    const code = sql.replace(/^--.*$/gm, "");
    expect(code).toMatch(
      /drop policy if exists "Users upload own document files" on storage\.objects;/,
    );
    expect(code).toMatch(
      /drop policy if exists "Users update own document files" on storage\.objects;/,
    );
    expect(code).not.toMatch(/create policy|grant|alter table|delete from/i);
  });

  it("app code never writes to Storage directly (only via upload-document)", () => {
    const hits = execSync(
      String.raw`git grep -nE "storage\s*\.from\([^)]*\)\s*\.(upload|update|uploadToSignedUrl|move|copy)\(" -- src ':!*.test.ts' || true`,
      { cwd: root, encoding: "utf8" },
    ).trim();
    expect(hits).toBe("");
  });
});
