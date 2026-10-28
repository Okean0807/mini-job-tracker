/**
 * The Feedback server function (variant C2): authenticated users only, user-scoped Supabase client,
 * no service-role key. createServerFn and the auth middleware are replaced with in-memory fakes
 * (same technique as ai.functions.test.ts); the real middleware is exercised by
 * scripts/feedback-transport-check.mjs.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({ middlewares: [] as unknown[] }));
const authMiddleware = vi.hoisted(() => ({ marker: "requireSupabaseAuth" }));

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validate: (input: unknown) => unknown = (input) => input;
    const chain = {
      middleware: (list: unknown[]) => {
        captured.middlewares = list;
        return chain;
      },
      inputValidator: (fn: (input: unknown) => unknown) => {
        validate = fn;
        return chain;
      },
      handler:
        (fn: (args: { data: unknown; context: unknown }) => Promise<unknown>) =>
        (opts: { data: unknown; context: unknown }) =>
          fn({ data: validate(opts.data), context: opts.context }),
    };
    return chain;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: authMiddleware }));

import { submitFeedback } from "./feedback.functions";
import { FeedbackError } from "./schema";

type Call = (opts: { data: unknown; context: unknown }) => Promise<unknown>;
const call = submitFeedback as unknown as Call;
const data = () => ({
  submissionId: crypto.randomUUID(),
  kind: "bug",
  message: "Der Export schlägt fehl",
  appVersion: "1.0.0",
  lang: "de",
  route: "/einstellungen",
});

let rpc: ReturnType<typeof vi.fn>;
beforeEach(() => {
  rpc = vi.fn(async () => ({ data: [{ status: "created", retry_after_seconds: 0 }], error: null }));
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("submitFeedback server function", () => {
  it("is protected by requireSupabaseAuth (authentication happens on the server)", () => {
    expect(captured.middlewares).toEqual([authMiddleware]);
  });

  it("uses the user-scoped client from the middleware context and sends no user id", async () => {
    const result = await call({ data: data(), context: { supabase: { rpc }, userId: "user-1" } });
    expect(result).toEqual({ ok: true, duplicate: false });
    expect(rpc).toHaveBeenCalledTimes(1);
    const [fn, args] = rpc.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(fn).toBe("submit_feedback");
    expect(Object.keys(args)).not.toContain("p_user_id");
    expect(JSON.stringify(args)).not.toContain("user-1"); // the author is never sent from here
  });

  it("without the middleware context nothing can be stored", async () => {
    await expect(call({ data: data(), context: undefined })).rejects.toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("invalid input never reaches the database", async () => {
    // the fake builder validates synchronously; the real server function rejects the same way
    await expect(
      (async () => call({ data: { ...data(), userId: "x" }, context: { supabase: { rpc } } }))(),
    ).rejects.toBeInstanceOf(FeedbackError);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("database statuses become safe error codes", async () => {
    rpc.mockResolvedValueOnce({
      data: [{ status: "rate_limited", retry_after_seconds: 90 }],
      error: null,
    });
    await expect(call({ data: data(), context: { supabase: { rpc } } })).rejects.toMatchObject({
      message: "feedback:rate_limited:90",
    });
    rpc.mockResolvedValueOnce({ data: null, error: { message: "SECRET-SQL" } });
    await expect(call({ data: data(), context: { supabase: { rpc } } })).rejects.toMatchObject({
      message: "feedback:unavailable:0",
    });
  });
});

describe("no service-role key and no guest mechanics in the Feedback path", () => {
  const files = ["feedback.functions.ts", "handler.ts", "schema.ts", "client.ts", "context.ts"];
  const code = (f: string) =>
    readFileSync(join(__dirname, f), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
  it.each(files)("%s does not use the service role, the admin client or IP/HMAC settings", (f) => {
    expect(code(f)).not.toMatch(
      /SERVICE_ROLE|service_role|supabaseAdmin|client\.server|FEEDBACK_HASH_SECRET|FEEDBACK_TRUST_PROXY|x-forwarded-for|createHmac/i,
    );
  });
});
