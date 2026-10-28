/**
 * Static access-model guards for Feedback (variant C2, authenticated users only). These read files
 * only; the SQL behaviour is tested by scripts/db-tests/feedback_run.sh against a TEMPORARY local
 * PostgreSQL with a stub of Supabase's auth schema (not part of CI, never run against Supabase).
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const PENDING = "supabase/pending/20261028120000_feedback.sql";
const sql = read(PENDING).replace(/^--.*$/gm, "");
const fn = sql.slice(sql.indexOf("create or replace function public.submit_feedback"));
const strip = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

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

describe("tables: no direct access for anyone but the owner", () => {
  it("RLS enabled on both tables; no policies; revoked from public/anon/authenticated; not forced", () => {
    for (const t of ["feedback", "feedback_rate_limits"]) {
      expect(sql).toMatch(new RegExp(`alter table public\\.${t} enable row level security`));
      expect(sql).toMatch(
        new RegExp(`revoke all on table public\\.${t} from public, anon, authenticated`),
      );
    }
    expect(sql).not.toMatch(/create\s+policy/i);
    expect(sql).not.toMatch(/force row level security/i);
  });

  it("rows belong to the user and disappear with the account", () => {
    expect(sql).toMatch(/user_id uuid not null references auth\.users\(id\) on delete cascade/);
    expect(sql).toMatch(/unique \(user_id, submission_id\)/);
    expect(sql).toMatch(
      /feedback_rate_limits \(\s*user_id uuid primary key references auth\.users\(id\) on delete cascade/,
    );
  });

  it("stores no IP, email or payload; keeps value constraints in the table", () => {
    const table = sql.slice(
      sql.indexOf("create table if not exists public.feedback ("),
      sql.indexOf("create index"),
    );
    expect(table).not.toMatch(/\bip\b|email|payload|client_key/i);
    expect(table).toMatch(/kind in \('bug', 'idea', 'rating'\)/);
    expect(table).toMatch(/rating between 1 and 5/);
    expect(table).toMatch(/char_length\(message\) <= 2000/);
  });
});

describe("submit_feedback: identity comes from the verified JWT only", () => {
  it("has no user-id parameter and takes the author from auth.uid()", () => {
    const signature = fn.slice(0, fn.indexOf(")\nreturns"));
    expect(signature).not.toMatch(/user_id|p_user|client_key/i);
    expect(fn).toMatch(/v_uid uuid := auth\.uid\(\)/);
    expect(fn).toMatch(/insert into public\.feedback\(user_id, /);
    expect(fn).toMatch(/values \(v_uid, /);
  });

  it("refuses missing identities and anonymous Supabase users", () => {
    expect(fn).toMatch(/if v_uid is null then[\s\S]*?'unauthenticated'/);
    expect(fn).toMatch(/auth\.jwt\(\) ->> 'is_anonymous'[\s\S]*?'forbidden'/);
  });

  it("is SECURITY DEFINER with a pinned search_path (pg_temp last)", () => {
    expect(fn).toMatch(/security definer/i);
    expect(fn).toMatch(/set search_path = public, pg_temp/);
  });

  it("validates kind, rating, text, language, version and route and answers with a status", () => {
    for (const needle of [
      "p_kind not in ('bug', 'idea', 'rating')",
      "p_rating not between 1 and 5",
      "char_length(p_message) > 2000",
      "p_lang not in ('de', 'en', 'ru', 'tr', 'pl')",
      "char_length(p_app_version) not between 1 and 32",
      "char_length(p_route) not between 1 and 64",
    ]) {
      expect(fn).toContain(needle);
    }
    expect(fn).toMatch(/'invalid'::text/);
    expect(fn).not.toMatch(/raise\s+exception/i); // expected conditions never raise SQL text
  });

  it("limits are per user: 5 per hour, 20 per day, no global limit, clock read after the lock", () => {
    expect(fn).toMatch(/cardinality\(v_hour\) >= 5/);
    expect(fn).toMatch(/cardinality\(v_day\) >= 20/);
    expect(sql).not.toMatch(/\*global\*|global/i);
    expect(fn.indexOf("v_now := ")).toBeGreaterThan(fn.indexOf("for update"));
    expect(sql).not.toMatch(/ai_rate_limits|consume_ai_rate_limit/); // quotas are never shared with the AI
  });

  it("EXECUTE only for authenticated; nothing for anon/public; nothing else is granted", () => {
    expect(sql).toMatch(
      /revoke all on function public\.submit_feedback\([^)]*\)\s+from public, anon, authenticated/,
    );
    const grants = [...sql.matchAll(/grant\s+[^;]+;/gi)].map((m) => m[0]);
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatch(/grant execute on function public\.submit_feedback/);
    expect(grants[0]).toMatch(/\bto authenticated;$/);
    expect(grants[0]).not.toMatch(/\bto\b[^;]*\b(anon|public|service_role)\b/);
  });
});

describe("application code: authenticated path, user-scoped client, no service role, no guest mechanics", () => {
  const files = sources(resolve(root, "src"));

  it("nothing in src queries the feedback table directly", () => {
    for (const f of files) {
      expect(readFileSync(f, "utf8"), relative(root, f)).not.toMatch(
        /from\(\s*["'`]feedback(_rate_limits)?["'`]\s*\)/,
      );
    }
  });

  it("the server function is protected by requireSupabaseAuth and uses the middleware's client", () => {
    const code = strip(read("src/lib/feedback/feedback.functions.ts"));
    expect(code).toMatch(/\.middleware\(\[requireSupabaseAuth\]\)/);
    expect(code).toMatch(/context\.supabase\.rpc\(/);
  });

  it("no Feedback file uses the service role, the admin client or IP/HMAC settings", () => {
    const fbFiles = files.filter(
      (f) =>
        relative(root, f).startsWith(join("src", "lib", "feedback")) ||
        relative(root, f).endsWith("FeedbackDialog.tsx"),
    );
    expect(fbFiles.length).toBeGreaterThanOrEqual(6);
    for (const f of fbFiles) {
      expect(strip(readFileSync(f, "utf8")), relative(root, f)).not.toMatch(
        /SERVICE_ROLE|service_role|supabaseAdmin|client\.server|FEEDBACK_HASH_SECRET|FEEDBACK_TRUST_PROXY|x-forwarded-for|createHmac|honeypot|name="website"/i,
      );
    }
  });

  it("the guest-only files are gone", () => {
    for (const f of ["client-key.ts", "client-key.test.ts", "feedback.server.ts"]) {
      expect(existsSync(resolve(root, "src/lib/feedback", f)), f).toBe(false);
    }
  });

  it("the AI rate limit is untouched by Feedback (no reference from Feedback code)", () => {
    for (const f of ["handler.ts", "feedback.functions.ts", "client.ts"]) {
      expect(read(`src/lib/feedback/${f}`)).not.toMatch(/consume_ai_rate_limit|ai_rate_limits/);
    }
  });
});
