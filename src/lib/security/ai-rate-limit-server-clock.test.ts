import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Static guard for the F-1 migration (moved into supabase/migrations after the
// isolated PG 17.6 author DB run, t604). Behaviour (limits, boundaries, races) is
// verified against an isolated PostgreSQL by scripts/db-tests/f1_isolated_run.sh /
// pr140_run.sh (not CI).
const FILE = "supabase/migrations/20261014100000_p2_ai_rate_limit_server_clock.sql";
const raw = readFileSync(FILE, "utf8");

/** Removes `-- …` line comments and block comments so commented-out text never satisfies a check. */
function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
}

const sql = stripSqlComments(raw);
const start = sql.indexOf("as $$");
const end = sql.lastIndexOf("$$;");
const body = sql.slice(start + "as $$".length, end);
const outside = sql.slice(0, start) + sql.slice(end + 3);
const norm = (s: string) => s.replace(/\s+/g, " ").trim();

describe("consume_ai_rate_limit (F-1): server clock only", () => {
  it("has exactly one function body", () => {
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    expect(sql.match(/create or replace function/gi)?.length).toBe(1);
  });

  it("never reads the caller-supplied p_now_ms inside the body", () => {
    expect(body).not.toMatch(/p_now_ms|\$2/);
  });

  it("assigns v_now from clock_timestamp() only AFTER the FOR UPDATE row lock (F-140-1)", () => {
    const lock = body.search(
      /select\s+minute_stamps\s*,\s*hour_stamps\s+into\s+v_minute\s*,\s*v_hour\s+from\s+public\.ai_rate_limits\s+where\s+user_id\s*=\s*p_user_id\s+for\s+update\s*;/i,
    );
    const assign = [
      ...body.matchAll(
        /v_now\s*:=\s*floor\(extract\(epoch from clock_timestamp\(\)\) \* 1000\)::bigint\s*;/gi,
      ),
    ];
    expect(lock).toBeGreaterThan(0);
    expect(assign).toHaveLength(1);
    expect(assign[0]?.index ?? -1).toBeGreaterThan(lock);
    expect(body).toMatch(/\bv_now bigint;/);
    expect(body.match(/\bv_now\s*:=/g)?.length).toBe(1);
  });

  it("keeps the auth check, limits 8/60 and exact boundary operators", () => {
    const b = norm(body);
    expect(b).toContain(
      "if auth.uid() is null or auth.uid() <> p_user_id then raise exception 'forbidden';",
    );
    expect(b).toContain("v_future_tolerance_ms constant bigint := 1000;");
    expect(b).toContain(
      "where x <= v_now + v_future_tolerance_ms and v_now - x < 60000 order by x",
    );
    expect(b).toContain(
      "where x <= v_now + v_future_tolerance_ms and v_now - x < 3600000 order by x",
    );
    expect(b).toContain("if cardinality(v_minute) >= 8 then");
    expect(b).toContain("if cardinality(v_hour) >= 60 then");
    expect(b).toContain("v_minute := array_append(v_minute, v_now);");
    expect(b).toContain("v_hour := array_append(v_hour, v_now);");
    expect(b).toContain("ceil((v_oldest + 60000 - v_now) / 1000.0)");
    expect(b).toContain("ceil((v_oldest + 3600000 - v_now) / 1000.0)");
  });

  it("keeps signature, return type, SECURITY DEFINER and search_path", () => {
    const o = norm(outside);
    expect(o).toContain(
      "create or replace function public.consume_ai_rate_limit( p_user_id uuid, p_now_ms bigint default floor(extract(epoch from clock_timestamp()) * 1000)::bigint ) returns table(allowed boolean, retry_after_seconds integer) language plpgsql security definer set search_path = public",
    );
  });

  it("has exactly the expected grants and nothing else outside the body", () => {
    const stmts = norm(
      outside.slice(
        outside.indexOf("set search_path = public") + "set search_path = public".length,
      ),
    )
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
    expect(stmts).toEqual([
      "revoke all on function public.consume_ai_rate_limit(uuid, bigint) from public, anon, authenticated",
      "grant execute on function public.consume_ai_rate_limit(uuid, bigint) to authenticated",
    ]);
    expect(sql).not.toMatch(/\bgrant\b[^;]*\bto\b[^;]*\b(anon|public|service_role)\b/i);
  });

  it("lives only in the migration chain (no stale pending copy)", () => {
    expect(existsSync("supabase/pending/20261014100000_p2_ai_rate_limit_server_clock.sql")).toBe(
      false,
    );
  });
});
