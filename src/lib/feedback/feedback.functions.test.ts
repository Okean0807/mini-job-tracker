/**
 * The Feedback server function: authenticated users only, e-mail through the injected mailer, no service
 * role, no database. createServerFn and the auth middleware are replaced with in-memory fakes (same
 * technique as ai.functions.test.ts); the REAL middleware is exercised in feedback.integration.test.ts.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
        async (opts: { data: unknown; context: unknown }) =>
          fn({ data: validate(opts.data), context: opts.context }),
    };
    return chain;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: authMiddleware }));

import { submitFeedback } from "./feedback.functions";

type Call = (opts: { data: unknown; context: unknown }) => Promise<unknown>;
const call = submitFeedback as unknown as Call;
const data = () => ({
  submissionId: crypto.randomUUID(),
  message: "Der Export schlägt fehl",
  appVersion: "1.0.0",
  lang: "de",
  route: "/einstellungen",
});
const ctx = (claims: Record<string, unknown> = { email: "user@example.test" }) => ({
  userId: "user-1",
  claims,
  supabase: {},
});

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  process.env["RESEND_API_KEY"] = "re_TEST_ONLY";
  process.env["FEEDBACK_TO_EMAIL"] = "owner@example.test";
  delete process.env["FEEDBACK_FROM_EMAIL"];
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "msg_1" }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env["RESEND_API_KEY"];
  delete process.env["FEEDBACK_TO_EMAIL"];
});

describe("submitFeedback", () => {
  it("is protected by requireSupabaseAuth (authentication happens on the server)", () => {
    expect(captured.middlewares).toEqual([authMiddleware]);
  });

  it("sends exactly one e-mail through the mail API to the configured recipient and confirms", async () => {
    await expect(call({ data: data(), context: ctx() })).resolves.toEqual({
      ok: true,
      duplicate: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    const body = JSON.parse(String(init.body));
    expect(body.to).toEqual(["owner@example.test"]);
    expect(body.reply_to).toBe("user@example.test");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer re_TEST_ONLY");
  });

  it("uses the e-mail from the verified claims only; the anonymous flag is refused", async () => {
    await expect(
      call({ data: data(), context: ctx({ is_anonymous: true }) }),
    ).rejects.toMatchObject({
      message: "feedback:forbidden:0",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("missing configuration -> unavailable, nothing sent", async () => {
    delete process.env["RESEND_API_KEY"];
    await expect(call({ data: data(), context: ctx() })).rejects.toMatchObject({
      message: "feedback:unavailable:0",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("the mail service refusing the message is never reported as success", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{"message":"SECRET provider text"}', { status: 403 }),
    );
    const error = await call({ data: data(), context: ctx() }).catch((e: Error) => e);
    expect((error as Error).message).toBe("feedback:unavailable:0");
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain("SECRET");
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain("re_TEST_ONLY");
  });

  it("invalid input never reaches the mail service", async () => {
    await expect(
      call({ data: { ...data(), to: "evil@example.com" }, context: ctx() }),
    ).rejects.toMatchObject({ message: "feedback:invalid:0" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("no service-role key, no database, no key in client-visible modules", () => {
  const strip = (code: string) =>
    code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const code = (f: string) => strip(readFileSync(join(__dirname, f), "utf8"));
  const serverOnly = ["feedback.functions.ts", "handler.ts", "mailer.ts", "rate-limit.ts"];

  it.each(serverOnly)("%s does not use the service role, the admin client or the database", (f) => {
    expect(code(f)).not.toMatch(
      /SERVICE_ROLE|service_role|supabaseAdmin|client\.server|\.rpc\(|\.from\(/,
    );
  });

  it("only the server function reads the mail secrets", () => {
    for (const f of [
      "schema.ts",
      "client.ts",
      "context.ts",
      "handler.ts",
      "mailer.ts",
      "rate-limit.ts",
    ]) {
      expect(code(f), f).not.toMatch(/process\.env/);
    }
    expect(code("feedback.functions.ts")).toMatch(/process\.env\["RESEND_API_KEY"\]/);
    const ui = strip(
      readFileSync(join(__dirname, "../../components/minijob/FeedbackDialog.tsx"), "utf8"),
    );
    expect(ui).not.toMatch(/RESEND|FEEDBACK_TO_EMAIL|process\.env|@example|jurivollmer/);
  });
});
