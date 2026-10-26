import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// supabase/migrations/ must equal the PRODUCTION migration history 1:1.
// Supabase GitHub integration has "Deploy to production" ON for main:
// any extra file here would be applied to the production DB on push.
const MIGRATIONS_DIR = resolve(process.cwd(), "supabase/migrations");

const EXPECTED = [
  "20260812221841_87a89883-538d-4966-9495-bdf2a0d1f782.sql",
  "20260813100911_c98cc035-089e-4220-8003-91c7596fec6a.sql",
  "20260813101912_845f16ab-c9cb-4900-b013-a9ffec85fe56.sql",
  "20260930192358_p1_account_isolation_documents.sql",
  "20260930192401_p1_document_upload_hardening.sql",
  "20260930192403_p1_storage_policy_drift_hardening.sql",
  "20260930192406_p1_ai_rate_limit.sql",
  "20260930192446_p1_security_definer_execute_hardening.sql",
  "20260930192515_p1_rls_performance_hardening.sql",
  // F-1: same bytes as release/v1.0-integration @ 08e3874 (isolated PG 17.6 author
  // DB run, t604); applied to production only when merged into main.
  "20261014100000_p2_ai_rate_limit_server_clock.sql",
];

// Pinned SHA-256 of migration file bytes.
// 192358/192401/192403/192406: repo files renamed unchanged (blob-identical to
//   3af8a08); SQL-equivalent to remote statements, NOT byte-identical
//   (comments/whitespace differ).
// 192446/192515: file content = remote schema_migrations.statements[1] + one
//   trailing LF.
// This pins the known list only; it cannot detect drift made directly in the
// remote database.
const PINNED_SHA256: Record<string, string> = {
  "20260930192358_p1_account_isolation_documents.sql":
    "656c541026ce2aa9bfff1509522b1f84aebcf74a20271b71d1b29462bef60d9a",
  "20260930192401_p1_document_upload_hardening.sql":
    "1707657ecaa1c780b7f0000a057c4aaad4151550e9381e13ffc39aa87e9d698a",
  "20260930192403_p1_storage_policy_drift_hardening.sql":
    "89fb84f845f91baa85d4930f494a10a47912c1cbe7af74164894aac55e7c1a51",
  "20260930192406_p1_ai_rate_limit.sql":
    "73e6131313afac3f9fbf12d8188dc28cad4c0637b5f678d19e951c66287110f8",
  "20260930192446_p1_security_definer_execute_hardening.sql":
    "06cf41f6f3476f72a4aa3e915b31f09af7c8606535c24e63a475c9c571d18419",
  "20260930192515_p1_rls_performance_hardening.sql":
    "d9f99e9f075da2c14847105e73a13ae97be4a6b605703e440de818905a779ae5",
  // the exact bytes exercised by scripts/db-tests/f1_isolated_run.sh (PG 17.6, t604)
  "20261014100000_p2_ai_rate_limit_server_clock.sql":
    "f6ea596997a98430c298916de8873809c3991a4875bab017b47f3566c30d30da",
};

const read = (f: string) => readFileSync(resolve(MIGRATIONS_DIR, f));

describe("supabase migrations guard (must mirror production history)", () => {
  const files = readdirSync(MIGRATIONS_DIR).sort();

  it("contains exactly the 10 expected migration files", () => {
    expect(files).toEqual(EXPECTED);
  });

  it("does not contain the not-yet-applied ai_rate_limit_rls migration", () => {
    expect(files).not.toContain("20260930220000_p1_ai_rate_limit_rls.sql");
  });

  it("has unique, ascending versions", () => {
    const versions = files.map((f) => f.split("_")[0]);
    expect(new Set(versions).size).toBe(versions.length);
    expect([...versions].sort()).toEqual(versions);
  });

  it("explicitly contains restored remote migrations 192446 and 192515", () => {
    expect(files).toContain("20260930192446_p1_security_definer_execute_hardening.sql");
    expect(files).toContain("20260930192515_p1_rls_performance_hardening.sql");
  });

  it("pins SHA-256 of P1 migration files (renamed 4 + restored 2)", () => {
    for (const [f, hash] of Object.entries(PINNED_SHA256)) {
      expect(files).toContain(f);
      expect(createHash("sha256").update(read(f)).digest("hex")).toBe(hash);
    }
  });

  it("192515 keeps its policy statements", () => {
    const sql = read("20260930192515_p1_rls_performance_hardening.sql").toString("utf8");
    for (const p of [
      "Users manage own backup",
      "Users manage own documents",
      "Users manage own folders",
      "Users read own document files",
      "Users upload own document files",
      "Users update own document files",
      "Users delete own document files",
    ]) {
      expect(sql).toContain(`CREATE POLICY "${p}"`);
    }
  });
});
