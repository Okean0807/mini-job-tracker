// @vitest-environment node
// Edge-function handler (Deno): native FormData/Request (undici) instead of happy-dom’s
// JS multipart parser, which needs seconds per 20 MiB body and timed out under load.
// Mock tests for supabase/functions/upload-document/handler.ts. Fake clients only.
import { describe, expect, it, vi } from "vitest";

import {
  type UploadAdminLike,
  type UploadDeps,
  MAX_SIZE,
  errorCode,
  handleUploadDocument,
  safeName,
} from "../../../supabase/functions/upload-document/handler.ts";

const UID = "11111111-1111-1111-1111-111111111111";
const PDF = new TextEncoder().encode("%PDF-1.4\n%%EOF\n");
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0]);

type Opts = {
  noUser?: boolean;
  uploadError?: boolean;
  insertError?: boolean;
  insertThrows?: boolean;
  removeError?: boolean;
  removeThrows?: boolean;
  folder?: "owned" | "missing" | "error";
  noEnv?: boolean;
  userAndError?: boolean;
};

function setup(o: Opts = {}) {
  const calls = {
    upload: [] as string[],
    remove: [] as string[][],
    insert: [] as Record<string, unknown>[],
  };
  const logs: { event: string; fields: Record<string, unknown> }[] = [];
  const folderEq: [string, string][] = [];
  const tokens: string[] = [];
  const uploadOpts: Record<string, unknown>[] = [];
  const bucket = {
    upload: vi.fn(async (path: string, _body: Uint8Array, opts: Record<string, unknown>) => {
      calls.upload.push(path);
      uploadOpts.push(opts);
      return {
        data: null,
        error: o.uploadError ? { name: "StorageError", message: "SECRET up" } : null,
      };
    }),
    remove: vi.fn(async (paths: string[]) => {
      calls.remove.push(paths);
      if (o.removeThrows) throw Object.assign(new Error("SECRET rm"), { name: "TypeError" });
      return {
        data: [],
        error: o.removeError ? { name: "StorageApiError", message: "SECRET rm" } : null,
      };
    }),
  };
  const admin: UploadAdminLike = {
    auth: {
      getUser: vi.fn(
        async (token: string) => (
          tokens.push(token),
          {
            data: { user: o.noUser ? null : { id: UID } },
            error: o.noUser || o.userAndError ? new Error("x") : null,
          }
        ),
      ),
    },
    storage: { from: vi.fn(() => bucket) },
    from: (table: string) => ({
      // Enforces the ownership filter: only (id=f1, user_id=UID) finds the folder.
      select: () => ({
        eq: (c1: string, v1: string) => ({
          eq: (c2: string, v2: string) => ({
            maybeSingle: async () => {
              folderEq.push([c1, v1], [c2, v2]);
              if (o.folder === "error") return { data: null, error: new Error("db") };
              const match =
                o.folder === "owned" &&
                c1 === "id" &&
                v1 === "f1" &&
                c2 === "user_id" &&
                v2 === UID;
              return { data: match ? { id: "f1" } : null, error: null };
            },
          }),
        }),
      }),
      insert: async (row: Record<string, unknown>) => {
        expect(table).toBe("documents");
        calls.insert.push(row);
        if (row["user_id"] !== UID) return { error: { code: "42501" } }; // RLS-like owner check
        if (o.insertThrows) throw Object.assign(new Error("SECRET net"), { name: "FetchError" });
        return { error: o.insertError ? { code: "23503", message: "SECRET fk detail" } : null };
      },
    }),
  };
  const deps: UploadDeps = {
    getEnv: (n) =>
      o.noEnv ? undefined : { SUPABASE_URL: "http://t", SUPABASE_SERVICE_ROLE_KEY: "k" }[n],
    createAdmin: () => admin,
    now: () => 1_700_000_000_000,
    uuid: () => "00000000-0000-4000-8000-000000000000",
    log: { error: (event, fields) => logs.push({ event, fields }) },
  };
  return { deps, calls, logs, bucket, folderEq, tokens, uploadOpts };
}

function req(
  parts: {
    file?: File | string;
    category?: string;
    folderId?: string;
    tags?: string;
    note?: string;
  } = {},
  init: { method?: string; auth?: string | null } = {},
) {
  const fd = new FormData();
  if (parts.file !== undefined) fd.append("file", parts.file as Blob);
  if (parts.category) fd.append("category", parts.category);
  if (parts.folderId) fd.append("folderId", parts.folderId);
  if (parts.tags !== undefined) fd.append("tags", parts.tags);
  if (parts.note !== undefined) fd.append("note", parts.note);
  const headers: Record<string, string> = {};
  if (init.auth !== null) headers["Authorization"] = init.auth ?? "Bearer tok";
  return new Request("http://t/upload-document", {
    method: init.method ?? "POST",
    headers,
    body: (init.method ?? "POST") === "POST" ? fd : null,
  });
}
const pdf = (name = "a.pdf") => new File([PDF], name, { type: "application/pdf" });

async function call(r: Request, o: Opts = {}) {
  const s = setup(o);
  const res = await handleUploadDocument(r, s.deps);
  return {
    ...s,
    res,
    status: res.status,
    body: (await res.json().catch(() => null)) as Record<string, unknown> | null,
  };
}

describe("upload-document: success and contract", () => {
  it("200 ok; path under <uid>/; no remove; no error log", async () => {
    const r = await call(req({ file: pdf() }));
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });
    expect(r.calls.upload).toHaveLength(1);
    expect(r.calls.upload[0]!.startsWith(`${UID}/`)).toBe(true);
    expect(r.calls.insert[0]!["path"]).toBe(r.calls.upload[0]);
    expect(r.calls.remove).toHaveLength(0);
    expect(r.logs).toEqual([]);
  });

  it.each([
    ["OPTIONS", 200, null],
    ["GET", 405, { error: "method-not-allowed" }],
  ])("%s -> %i", async (method, status, body) => {
    const s = setup();
    const res = await handleUploadDocument(req({}, { method }), s.deps);
    expect(res.status).toBe(status);
    if (body) expect(await res.json()).toEqual(body);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it.each([
    ["missing auth", req({ file: pdf() }, { auth: null }), {}, 401, "not-signed-in"],
    ["no user", req({ file: pdf() }), { noUser: true }, 401, "not-signed-in"],
    ["no file", req({}), {}, 400, "file-required"],
    [
      "bad mime",
      req({ file: new File([PDF], "a.txt", { type: "text/plain" }) }),
      {},
      415,
      "file-type-not-allowed",
    ],
    [
      "content mismatch",
      req({ file: new File([PNG], "a.pdf", { type: "application/pdf" }) }),
      {},
      415,
      "file-content-mismatch",
    ],
    [
      "bad ext",
      req({ file: new File([PDF], "a.exe", { type: "application/pdf" }) }),
      {},
      415,
      "file-extension-not-allowed",
    ],
    ["bad tags", req({ file: pdf(), tags: "{" }), {}, 400, "invalid-tags"],
    [
      "folder not owned",
      req({ file: pdf(), folderId: "f9" }),
      { folder: "missing" },
      403,
      "folder-not-owned",
    ],
    [
      "folder check error",
      req({ file: pdf(), folderId: "f9" }),
      { folder: "error" },
      500,
      "folder-check-failed",
    ],
    ["upload error", req({ file: pdf() }), { uploadError: true }, 500, "storage-upload-failed"],
  ] as const)("%s -> %i %s (nothing removed)", async (_n, r, o, status, code) => {
    const x = await call(r, o);
    expect(x.status).toBe(status);
    expect(x.body).toEqual({ error: code });
    expect(x.calls.remove).toHaveLength(0);
  });

  it("upload error: no insert", async () => {
    const x = await call(req({ file: pdf() }), { uploadError: true });
    expect(x.calls.insert).toHaveLength(0);
  });
});

describe("upload-document: D3 failed metadata insert", () => {
  const cases: [string, Opts, "ok" | "error" | "threw"][] = [
    ["insert error, remove ok", { insertError: true }, "ok"],
    ["insert error, remove returns error", { insertError: true, removeError: true }, "error"],
    ["insert error, remove throws", { insertError: true, removeThrows: true }, "threw"],
    ["insert throws, remove ok", { insertThrows: true }, "ok"],
    ["insert throws, remove returns error", { insertThrows: true, removeError: true }, "error"],
    ["insert throws, remove throws", { insertThrows: true, removeThrows: true }, "threw"],
  ];
  it.each(cases)(
    "%s -> 500 document-record-failed, exactly one remove of the uploaded path",
    async (_n, o, cleanup) => {
      const x = await call(req({ file: pdf() }), o);
      expect(x.status).toBe(500);
      expect(x.body).toEqual({ error: "document-record-failed" });
      expect(x.res.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(x.calls.remove).toEqual([[x.calls.upload[0]]]);
      expect(x.bucket.remove).toHaveBeenCalledTimes(1);
      expect(x.logs[0]!.event).toBe("upload-document.insert-failed");
      if (cleanup === "ok") expect(x.logs).toHaveLength(1);
      else {
        expect(x.logs).toHaveLength(2);
        expect(x.logs[1]).toEqual({
          event: "upload-document.cleanup-failed",
          fields: expect.objectContaining({ result: cleanup, orphan: true }),
        });
      }
    },
  );

  it("no internals in response or logs (messages, path, uid, file name)", async () => {
    const x = await call(req({ file: pdf("secret-name.pdf") }), {
      insertError: true,
      removeError: true,
    });
    const out = JSON.stringify(x.body) + JSON.stringify(x.logs);
    for (const s of ["SECRET", UID, "secret-name", "fk detail"]) expect(out).not.toContain(s);
    expect(x.logs[0]!.fields).toEqual({ cause: "23503" });
  });

  it("unexpected throw outside insert -> generic 500 internal-error with CORS", async () => {
    const s = setup();
    s.deps.createAdmin = () => {
      throw new Error("SECRET boom");
    };
    const res = await handleUploadDocument(req({ file: pdf() }), s.deps);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal-error" });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(JSON.stringify(s.logs)).not.toContain("SECRET");
  });
});

describe("upload-document: ownership invariants (cross-user regressions must fail)", () => {
  it("getUser receives exactly the Bearer token", async () => {
    const x = await call(req({ file: pdf() }, { auth: "Bearer tok-123" }));
    expect(x.tokens).toEqual(["tok-123"]);
  });

  it("folder lookup filters by id AND user_id = caller; owned folder accepted", async () => {
    const x = await call(req({ file: pdf(), folderId: "f1" }), { folder: "owned" });
    expect(x.status).toBe(200);
    expect(x.folderEq).toEqual([
      ["id", "f1"],
      ["user_id", UID],
    ]);
    expect(x.calls.insert[0]!["folder_id"]).toBe("f1");
  });

  it("another user's folder id is rejected (403) and nothing is uploaded", async () => {
    const x = await call(req({ file: pdf(), folderId: "f-other" }), { folder: "owned" });
    expect(x.status).toBe(403);
    expect(x.body).toEqual({ error: "folder-not-owned" });
    expect(x.calls.upload).toHaveLength(0);
  });

  it("inserted row is owned by the caller and path is under <uid>/", async () => {
    const x = await call(req({ file: pdf() }));
    const row = x.calls.insert[0]!;
    expect(row["user_id"]).toBe(UID);
    expect(String(row["path"]).split("/")[0]).toBe(UID);
  });
});

describe("upload-document: logs carry codes only", () => {
  it("message-only insert error -> cause 'unknown', message never logged", async () => {
    const s = setup({ insertError: true });
    // replace insert error with a message-only object
    const orig = s.deps.createAdmin;
    s.deps.createAdmin = (u, k) => {
      const a = orig(u, k);
      const from = a.from.bind(a);
      a.from = (t: string) => ({
        ...from(t),
        insert: async () => ({ error: { message: "SECRET only message" } }),
      });
      return a;
    };
    const res = await handleUploadDocument(req({ file: pdf() }), s.deps);
    expect(res.status).toBe(500);
    expect(s.logs[0]).toEqual({
      event: "upload-document.insert-failed",
      fields: { cause: "unknown" },
    });
    expect(JSON.stringify(s.logs)).not.toContain("SECRET");
  });

  it("errorCode never returns a message", () => {
    expect(errorCode({ message: "SECRET" })).toBe("unknown");
    expect(errorCode(new Error("SECRET"))).toBe("Error");
    expect(errorCode({ code: "23503", message: "SECRET" })).toBe("23503");
    expect(errorCode("SECRET")).toBe("unknown");
    expect(errorCode(null)).toBe("unknown");
  });
});

describe("upload-document: limits and helpers", () => {
  // Note: a 0-byte File is dropped/normalised by the Node (undici) FormData used here,
  // so the size<=0 branch cannot be reached via Request in Vitest; it is tested
  // implicitly only by code review (handler keeps `file.size <= 0`).
  it.each([
    ["> 20 MiB", new File([PDF, new Uint8Array(MAX_SIZE)], "a.pdf", { type: "application/pdf" })],
  ])("%s -> 413 file-too-large", async (_n, f) => {
    const x = await call(req({ file: f }));
    expect(x.status).toBe(413);
    expect(x.body).toEqual({ error: "file-too-large" });
    expect(x.calls.upload).toHaveLength(0);
  });

  it("exactly 20 MiB is accepted", async () => {
    const big = new Uint8Array(MAX_SIZE);
    big.set(PDF);
    const x = await call(req({ file: new File([big], "a.pdf", { type: "application/pdf" }) }));
    expect(x.status).toBe(200);
  });

  it("non-form body -> 400 invalid-form", async () => {
    const s = setup();
    const r = new Request("http://t/upload-document", {
      method: "POST",
      headers: { Authorization: "Bearer tok", "Content-Type": "application/json" },
      body: "{}",
    });
    const res = await handleUploadDocument(r, s.deps);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid-form" });
  });

  it("missing env -> 500 server-not-configured before any client call", async () => {
    const x = await call(req({ file: pdf() }), { noEnv: true });
    expect(x.status).toBe(500);
    expect(x.body).toEqual({ error: "server-not-configured" });
    expect(x.tokens).toEqual([]);
  });

  it("upload uses upsert:false and the validated MIME type", async () => {
    const x = await call(req({ file: pdf() }));
    expect(x.uploadOpts[0]).toEqual({ contentType: "application/pdf", upsert: false });
  });

  it("safeName strips unsafe characters and traversal from the stored path", async () => {
    expect(safeName("../../etc/pass wd.pdf")).toBe(".._.._etc_pass_wd.pdf");
    expect(safeName("a".repeat(100) + ".pdf")).toHaveLength(80);
    const x = await call(req({ file: pdf("../x y.pdf") }));
    const seg = x.calls.upload[0]!.split("/");
    expect(seg).toHaveLength(2);
    expect(seg[0]).toBe(UID);
    expect(seg[1]).toMatch(/^[\w.-]+$/);
  });
});

describe("upload-document: auth and field limits", () => {
  it("getUser returning a user AND an error is rejected (401)", async () => {
    const x = await call(req({ file: pdf() }), { userAndError: true });
    expect(x.status).toBe(401);
    expect(x.calls.upload).toHaveLength(0);
  });

  it("tags: max 12 strings, each max 32 chars, non-strings dropped; note max 2000", async () => {
    const tags = JSON.stringify([
      ...Array.from({ length: 15 }, (_, i) => `t${i}`.padEnd(40, "x")),
      5,
    ]);
    const x = await call(req({ file: pdf(), tags, note: "n".repeat(2500) }));
    const row = x.calls.insert[0]!;
    expect(row["tags"]).toHaveLength(12);
    expect((row["tags"] as string[]).every((t) => t.length === 32)).toBe(true);
    expect(String(row["note"])).toHaveLength(2000);
  });
});
