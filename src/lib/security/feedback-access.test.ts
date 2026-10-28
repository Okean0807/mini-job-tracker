/**
 * Static access-model guards for Feedback. These read files only; the SQL behaviour is tested
 * by scripts/db-tests/feedback_run.sh against an isolated local PostgreSQL (not part of CI,
 * and not run against Supabase).
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const PENDING = "supabase/pending/20261028120000_feedback.sql";
const sql = read(PENDING).replace(/^--.*$/gm, "");

function sources(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (/\.(ts|tsx)$/.test(e) && !/\.test\.(ts|tsx)$/.test(e)) out.push(p);
  }
  return out;
}

describe("migration draft is not part of the migration chain", () => {
  it("lives in supabase/pending only (merging must not change any database)", () => {
    expect(existsSync(resolve(root, PENDING))).toBe(true);
    const chain = readdirSync(resolve(root, "supabase/migrations"));
    expect(chain.some((f) => /feedback/i.test(f))).toBe(false);
    expect(
      existsSync(resolve(root, "supabase/pending/rollback/20261028120000_feedback.rollback.sql")),
    ).toBe(true);
  });
});

describe("no public read, insert, update or delete", () => {
  it("RLS enabled on both tables; no policies at all; RLS is NOT forced (no BYPASSRLS dependency)", () => {
    for (const t of ["feedback", "feedback_rate_limits"]) {
      expect(sql).toMatch(new RegExp(`alter table public\\.${t} enable row level security`));
      expect(sql).toMatch(
        new RegExp(`revoke all on table public\\.${t} from public, anon, authenticated`),
      );
    }
    expect(sql).not.toMatch(/create\s+policy/i);
    expect(sql).not.toMatch(/force row level security/i);
  });

  it("only service_role may execute submit_feedback; nobody else is granted anything", () => {
    expect(sql).toMatch(
      /revoke all on function public\.submit_feedback\([^)]*\)\s+from public, anon, authenticated/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.submit_feedback\([^)]*\)\s+to service_role;/,
    );
    const grants = [...sql.matchAll(/grant\s+[^;]+;/gi)].map((m) => m[0]);
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatch(/\bto service_role;$/);
    expect(grants[0]).not.toMatch(/\bto\b[^;]*\b(anon|authenticated|public)\b/);
  });

  it("the function is SECURITY DEFINER with a pinned search_path", () => {
    expect(sql).toMatch(/security definer/i);
    expect(sql).toMatch(/set search_path = public, pg_temp/);
  });

  it("stores no user id, IP, email or payload; keeps value constraints in the table", () => {
    const table = sql.slice(
      sql.indexOf("create table if not exists public.feedback ("),
      sql.indexOf("create index"),
    );
    expect(table).not.toMatch(/user_id|\bip\b|email|payload/i);
    expect(table).toMatch(/kind in \('bug', 'idea', 'rating'\)/);
    expect(table).toMatch(/rating between 1 and 5/);
    expect(table).toMatch(/char_length\(message\) <= 2000/);
  });

  it("the rate limit clock is read after the row locks (concurrency regression)", () => {
    expect(sql.indexOf("v_now := ")).toBeGreaterThan(sql.indexOf("for update"));
  });
});

describe("no client path reads the table; no secrets in client code", () => {
  const files = sources(resolve(root, "src"));
  it("nothing in src queries the feedback table directly", () => {
    for (const f of files) {
      expect(readFileSync(f, "utf8"), relative(root, f)).not.toMatch(
        /from\(\s*["'`]feedback["'`]\s*\)/,
      );
    }
  });

  it("client-side feedback modules never reference service_role or the admin client", () => {
    for (const f of [
      "src/components/minijob/FeedbackDialog.tsx",
      "src/lib/feedback/client.ts",
      "src/lib/feedback/schema.ts",
      "src/lib/feedback/context.ts",
      "src/lib/feedback/feedback.functions.ts",
    ]) {
      const code = read(f)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      expect(code, f).not.toMatch(/service_role|SERVICE_ROLE|supabaseAdmin|client\.server/);
    }
    // the server file is only reached through a dynamic import inside the handler
    expect(read("src/lib/feedback/feedback.functions.ts")).toMatch(
      /await import\("\.\/feedback\.server"\)/,
    );
  });

  it("the server function takes no auth middleware, so guests can send", () => {
    expect(read("src/lib/feedback/feedback.functions.ts")).not.toMatch(/requireSupabaseAuth/);
  });
});
