// QA #137: error paths must never leak error details to console or client, and
// 0-byte files must be rejected before any Storage upload / metadata insert.
import { inspect } from "node:util";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type UploadAdminLike,
  type UploadDeps,
  handleUploadDocument,
} from "../../../supabase/functions/upload-document/handler.ts";

const SENTINEL = "PRIVATE_ERROR_SENTINEL_137";
const UID = "11111111-1111-1111-1111-111111111111";
const PDF = new TextEncoder().encode("%PDF-1.4\n%%EOF\n");

type Fail =
  | "getUser-throws"
  | "upload-error"
  | "insert-error"
  | "insert-throws+remove-throws"
  | "insert-error+remove-error";

function sentinelError(name = "Error") {
  const e = new Error(`${SENTINEL} message`);
  e.name = name;
  e.stack = `${name}: ${SENTINEL} stack`;
  return Object.assign(e, { details: SENTINEL, hint: { nested: SENTINEL } });
}

function setup(fail?: Fail) {
  const calls = { upload: 0, insert: 0, remove: 0 };
  const logged: unknown[][] = [];
  const bucket = {
    upload: vi.fn(async () => {
      calls.upload++;
      return { data: null, error: fail === "upload-error" ? sentinelError("StorageError") : null };
    }),
    remove: vi.fn(async () => {
      calls.remove++;
      if (fail === "insert-throws+remove-throws") throw sentinelError("TypeError");
      return { data: [], error: fail === "insert-error+remove-error" ? sentinelError() : null };
    }),
  };
  const admin: UploadAdminLike = {
    auth: {
      getUser: vi.fn(async () => {
        if (fail === "getUser-throws") throw sentinelError("AuthRetryableFetchError");
        return { data: { user: { id: UID } }, error: null };
      }),
    },
    storage: { from: () => bucket },
    from: () => ({
      select: () => ({
        eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
      }),
      insert: async () => {
        calls.insert++;
        if (fail === "insert-throws+remove-throws") throw sentinelError("FetchError");
        return {
          error: fail?.startsWith("insert-error")
            ? Object.assign(sentinelError(), { code: "23503" })
            : null,
        };
      },
    }),
  };
  const deps: UploadDeps = {
    getEnv: (n) => ({ SUPABASE_URL: "http://t", SUPABASE_SERVICE_ROLE_KEY: "k" })[n],
    createAdmin: () => admin,
    now: () => 1_700_000_000_000,
    uuid: () => "00000000-0000-4000-8000-000000000000",
    log: { error: (event, fields) => logged.push([event, fields]) },
  };
  return { deps, calls, logged };
}

function req(file: File) {
  const fd = new FormData();
  fd.append("file", file);
  return new Request("http://t/upload-document", {
    method: "POST",
    headers: { Authorization: "Bearer tok" },
    body: fd,
  });
}
const pdf = () => new File([PDF], "a.pdf", { type: "application/pdf" });

/** Every way an argument could be rendered by a logger. */
function renderings(a: unknown): string[] {
  const out = [String(a), inspect(a, { depth: 10, showHidden: true })];
  try {
    out.push(JSON.stringify(a) ?? "");
  } catch {
    /* circular: inspect covers it */
  }
  if (a instanceof Error)
    out.push(
      a.message,
      a.stack ?? "",
      JSON.stringify(Object.getOwnPropertyNames(a).map((k) => (a as never)[k])),
    );
  return out;
}
const leaks = (args: unknown[][]) =>
  args.flat().some((a) => renderings(a).some((s) => s.includes(SENTINEL)));

describe("upload-document: no error-detail leak (sentinel)", () => {
  let spies: ReturnType<typeof vi.spyOn>[] = [];
  beforeEach(() => {
    spies = (["error", "warn", "log", "info", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
  });
  afterEach(() => spies.forEach((s) => s.mockRestore()));

  it("renderings() really detects a sentinel inside an Error (self-check)", () => {
    expect(leaks([[sentinelError()]])).toBe(true);
    expect(leaks([[{ e: { cause: sentinelError() } }]])).toBe(true);
    expect(leaks([["ok", { cause: "23503" }]])).toBe(false);
  });

  it.each<[Fail, number, string]>([
    ["getUser-throws", 500, "internal-error"],
    ["upload-error", 500, "storage-upload-failed"],
    ["insert-error", 500, "document-record-failed"],
    ["insert-error+remove-error", 500, "document-record-failed"],
    ["insert-throws+remove-throws", 500, "document-record-failed"],
  ])(
    "%s: sentinel in no console arg, no log field, not in response",
    async (fail, status, code) => {
      const s = setup(fail);
      const res = await handleUploadDocument(req(pdf()), s.deps);
      const text = await res.text();

      expect(res.status).toBe(status);
      expect(JSON.parse(text)).toEqual({ error: code }); // generic, code only
      expect(text).not.toContain(SENTINEL);
      expect(text).not.toMatch(/message|stack|details|hint/i);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");

      for (const spy of spies) expect(leaks(spy.mock.calls as unknown[][])).toBe(false);
      expect(leaks(s.logged)).toBe(false);
    },
  );

  it("the error path was actually reached (structured log emitted)", async () => {
    const s = setup("insert-throws+remove-throws");
    await handleUploadDocument(req(pdf()), s.deps);
    expect(s.logged.map((l) => l[0])).toEqual([
      "upload-document.insert-failed",
      "upload-document.cleanup-failed",
    ]);
    expect(s.calls.remove).toBe(1);
  });
});

describe("upload-document: 0-byte file", () => {
  const empty = () => new File([], "a.pdf", { type: "application/pdf" });

  it("via multipart Request -> 400, no Storage upload, no metadata insert", async () => {
    // In the test runtime the 0-byte part is not surfaced as a File, so the
    // handler answers 400 file-required (current observable contract here).
    const s = setup();
    const res = await handleUploadDocument(req(empty()), s.deps);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "file-required" });
    expect(s.calls).toEqual({ upload: 0, insert: 0, remove: 0 });
  });

  it("size<=0 branch itself (real File with size 0, as Deno delivers it) is rejected before upload/insert", async () => {
    const s = setup();
    const f = empty();
    const r = req(f);
    vi.spyOn(r, "formData").mockResolvedValue({
      get: (k: string) => (k === "file" ? f : null),
    } as FormData);
    const res = await handleUploadDocument(r, s.deps);
    expect(f.size).toBe(0);
    expect(res.status).toBe(413); // handler contract: size<=0 || >MAX -> 413 file-too-large
    expect(await res.json()).toEqual({ error: "file-too-large" });
    expect(s.calls).toEqual({ upload: 0, insert: 0, remove: 0 });
  });
});
