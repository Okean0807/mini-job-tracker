import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/pending/20261014100000_p2_ai_rate_limit_server_clock.sql",
  "utf8",
);
const body = sql.slice(sql.indexOf("as $$"), sql.lastIndexOf("$$;"));

describe("pending consume_ai_rate_limit: server clock only", () => {
  it("never uses the caller-supplied p_now_ms inside the body", () => {
    expect(body).not.toMatch(/p_now_ms/);
    expect(body).toMatch(
      /v_now bigint := floor\(extract\(epoch from clock_timestamp\(\)\) \* 1000\)::bigint/,
    );
  });
  it("keeps signature, SECURITY DEFINER, search_path and the auth.uid() check", () => {
    expect(sql).toMatch(/consume_ai_rate_limit\(\s*p_user_id uuid,\s*p_now_ms bigint default/);
    expect(sql).toMatch(/security definer\s+set search_path = public/);
    expect(body).toMatch(/auth\.uid\(\) is null or auth\.uid\(\) <> p_user_id/);
  });
  it("discards future stamps and keeps grants minimal", () => {
    expect(body.match(/x <= v_now/g)?.length).toBe(2);
    expect(sql).toMatch(
      /revoke all on function public\.consume_ai_rate_limit\(uuid, bigint\) from public, anon, authenticated;/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.consume_ai_rate_limit\(uuid, bigint\) to authenticated;/,
    );
    expect(sql).not.toMatch(
      /\b(drop|alter table|insert into public\.ai_rate_limits\(user_id\) values \(auth)/i,
    );
  });
  it("is not in the applied migration chain", () => {
    expect(() =>
      readFileSync("supabase/migrations/20261014100000_p2_ai_rate_limit_server_clock.sql"),
    ).toThrow();
  });
});
