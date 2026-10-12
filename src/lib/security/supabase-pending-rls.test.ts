import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Content check of a PENDING file only. This migration is NOT applied in
// production (ai_rate_limits.relrowsecurity = false as of 2026-10-11).
// Passing this test does NOT mean RLS is active in production.
describe("PENDING (not applied in prod): 20260930220000_p1_ai_rate_limit_rls.sql content", () => {
  it("enables RLS on ai_rate_limits and creates no client policy", () => {
    const sql = readFileSync(
      resolve(process.cwd(), "supabase/pending/20260930220000_p1_ai_rate_limit_rls.sql"),
      "utf8",
    );
    expect(sql).toMatch(/enable row level security/i);
    expect(sql).not.toMatch(/create policy/i);
  });
});
