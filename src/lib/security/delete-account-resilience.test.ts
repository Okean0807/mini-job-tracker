// Resilience tests for supabase/functions/delete-account/handler.ts (PR #133 closure).
// Fake clients only: no network, no real Storage/Auth/Postgres.
import { describe, expect, it, vi } from "vitest";

import {
  type AdminClientLike,
  type StorageBucketLike,
  type StorageListItem,
  MAX_FOLDER_DEPTH,
  handleDeleteAccount,
  listAllUserObjectPaths,
} from "../../../supabase/functions/delete-account/handler.ts";

const U = "11111111-1111-1111-1111-111111111111";
const O = "11111111-1111-1111-1111-1111111111112"; // prefix-collision "other" uid

type Page = { data: StorageListItem[] | null; error: unknown };

/** Bucket whose listing is a tree; supports raw page scripting and fault injection. */
class TreeBucket implements StorageBucketLike {
  files = new Set<string>();
  folders = new Set<string>();
  listCalls: { path: string; offset: number; limit: number }[] = [];
  removeCalls: string[][] = [];
  failList?: (path: string, offset: number) => boolean;
  failRemoveAt?: number;
  removeIsNoop = false;
  override?: (path: string, offset: number, limit: number) => Page | undefined;
  constructor(files: string[] = []) {
    files.forEach((f) => this.files.add(f));
  }
  async list(path: string, o: { limit: number; offset: number }): Promise<Page> {
    this.listCalls.push({ path, offset: o.offset, limit: o.limit });
    if (this.failList?.(path, o.offset)) return { data: null, error: new Error("list") };
    const ov = this.override?.(path, o.offset, o.limit);
    if (ov) return ov;
    const pre = `${path}/`;
    const kids = new Map<string, StorageListItem>();
    for (const f of this.files)
      if (f.startsWith(pre)) {
        const [h, ...t] = f.slice(pre.length).split("/");
        kids.set(h!, { name: h!, id: t.length ? null : `id:${f}` });
      }
    for (const d of this.folders)
      if (d.startsWith(pre)) {
        const h = d.slice(pre.length).split("/")[0]!;
        if (!kids.has(h)) kids.set(h, { name: h, id: null });
      }
    const s = [...kids.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return { data: s.slice(o.offset, o.offset + o.limit), error: null };
  }
  async remove(paths: string[]) {
    this.removeCalls.push(paths);
    if (this.failRemoveAt === this.removeCalls.length)
      return { data: null, error: new Error("rm") };
    if (!this.removeIsNoop) paths.forEach((p) => this.files.delete(p));
    return { data: [], error: null };
  }
}

function harness(
  b: TreeBucket,
  o: {
    noUser?: boolean;
    failTable?: string;
    failDeleteUser?: boolean;
    onTable?: (t: string) => void;
  } = {},
) {
  const order: string[] = [];
  let deleted = false;
  const origList = b.list.bind(b);
  b.list = async (p, opt) => {
    order.push(`list:${p}`);
    return origList(p, opt);
  };
  const origRm = b.remove.bind(b);
  b.remove = async (p) => {
    order.push("remove");
    return origRm(p);
  };
  const admin: AdminClientLike = {
    auth: {
      getUser: vi.fn(async () =>
        o.noUser || deleted
          ? { data: { user: null }, error: new Error("user_not_found") }
          : { data: { user: { id: U } }, error: null },
      ),
      admin: {
        deleteUser: vi.fn(async (id: string) => {
          order.push(`deleteUser:${id}`);
          if (o.failDeleteUser) return { error: new Error("x") };
          deleted = true;
          return { error: null };
        }),
      },
    },
    storage: { from: () => b },
    from: (t: string) => ({
      delete: () => ({
        eq: async (c: string, v: string) => {
          order.push(`db:${t}:${c}=${v}`);
          o.onTable?.(t);
          return { error: o.failTable === t ? new Error("db") : null };
        },
      }),
    }),
  };
  const call = async () => {
    const res = await handleDeleteAccount(
      new Request("http://t/delete-account", {
        method: "POST",
        headers: { Authorization: "Bearer tok" },
      }),
      {
        getEnv: (n) => ({ SUPABASE_URL: "http://t", SUPABASE_SERVICE_ROLE_KEY: "k" })[n],
        createAdmin: () => admin,
      },
    );
    return { status: res.status, body: (await res.json()) as Record<string, unknown>, res };
  };
  return { admin, order, call };
}

const files = (n: number, dir = U) =>
  Array.from({ length: n }, (_, i) => `${dir}/f${String(i).padStart(5, "0")}.pdf`);

describe("delete-account resilience (fake clients)", () => {
  it("R1 exactly 1000 entries: second (empty) page is read at offset 1000", async () => {
    const b = new TreeBucket(files(1000));
    const paths = await listAllUserObjectPaths(b, U);
    expect(paths).toHaveLength(1000);
    expect(b.listCalls.map((c) => c.offset)).toEqual([0, 1000]);
  });

  it.each([2000, 3000])(
    "R2 %i entries (multiple of 1000): all pages, all removed in <=1000 batches",
    async (n) => {
      const b = new TreeBucket(files(n));
      const h = harness(b);
      const r = await h.call();
      expect(r.status).toBe(200);
      expect(b.files.size).toBe(0);
      expect(b.removeCalls.every((c) => c.length <= 1000)).toBe(true);
      expect(b.removeCalls).toHaveLength(n / 1000);
      expect(b.listCalls.filter((c) => c.path === U).map((c) => c.offset)).toContain(n);
    },
  );

  it("R3 folders spread over several pages are all traversed", async () => {
    const fs = files(1500).concat([`${U}/aaa/x.pdf`, `${U}/f00999z/y.pdf`, `${U}/zzz/deep/z.pdf`]);
    const b = new TreeBucket(fs);
    const p = await listAllUserObjectPaths(b, U);
    expect(p).toHaveLength(1503);
    expect(p).toEqual(expect.arrayContaining([`${U}/f00999z/y.pdf`, `${U}/zzz/deep/z.pdf`]));
  });

  it("R4 offset advances by RAW page length (folders count toward the page)", async () => {
    const b = new TreeBucket();
    b.override = (path, offset) => {
      if (path !== U) return { data: [], error: null };
      if (offset === 0)
        return {
          data: Array.from({ length: 1000 }, (_, i) =>
            i % 2 ? { name: `d${i}`, id: null } : { name: `f${i}.pdf`, id: `x${i}` },
          ),
          error: null,
        };
      if (offset === 1000) return { data: [{ name: "last.pdf", id: "l" }], error: null };
      throw new Error(`unexpected offset ${offset}`);
    };
    const p = await listAllUserObjectPaths(b, U);
    expect(p).toContain(`${U}/last.pdf`);
    expect(p).toHaveLength(501);
  });

  it("R5a null data page is treated as empty (no crash)", async () => {
    const b = new TreeBucket();
    b.override = () => ({ data: null, error: null });
    await expect(listAllUserObjectPaths(b, U)).resolves.toEqual([]);
  });

  it.each(["", ".", "..", "a/b"])(
    "R5b invalid name %j -> 500 storage-path-invalid, nothing removed, user kept",
    async (name) => {
      const b = new TreeBucket();
      b.override = (path) => (path === U ? { data: [{ name, id: "x" }], error: null } : undefined);
      const h = harness(b);
      const r = await h.call();
      expect(r.status).toBe(500);
      expect(r.body).toEqual({ error: "storage-path-invalid" });
      expect(b.removeCalls).toHaveLength(0);
      expect(h.admin.auth.admin.deleteUser).not.toHaveBeenCalled();
      expect(h.order.some((x) => x.startsWith("db:"))).toBe(false);
    },
  );

  it("R6 duplicate folder entries are listed once (visited set)", async () => {
    const b = new TreeBucket([`${U}/a/x.pdf`]);
    b.override = (path) =>
      path === U
        ? {
            data: [
              { name: "a", id: null },
              { name: "a", id: null },
            ],
            error: null,
          }
        : undefined;
    const p = await listAllUserObjectPaths(b, U);
    expect(p).toEqual([`${U}/a/x.pdf`]);
    expect(b.listCalls.filter((c) => c.path === `${U}/a`)).toHaveLength(1);
  });

  it("R7 depth beyond MAX_FOLDER_DEPTH -> storage-list-too-deep, nothing removed", async () => {
    const deep =
      `${U}/` +
      Array.from({ length: MAX_FOLDER_DEPTH + 1 }, (_, i) => `d${i}`).join("/") +
      "/x.pdf";
    const b = new TreeBucket([deep]);
    const h = harness(b);
    const r = await h.call();
    expect(r.body).toEqual({ error: "storage-list-too-deep" });
    expect(b.removeCalls).toHaveLength(0);
    expect(h.admin.auth.admin.deleteUser).not.toHaveBeenCalled();
  });

  it("R7b depth exactly MAX_FOLDER_DEPTH is allowed", async () => {
    const ok =
      `${U}/` + Array.from({ length: MAX_FOLDER_DEPTH }, (_, i) => `d${i}`).join("/") + "/x.pdf";
    const r = await harness(new TreeBucket([ok])).call();
    expect(r.status).toBe(200);
  });

  it("R8 read error on a LATER page aborts before any remove", async () => {
    const b = new TreeBucket(files(1500));
    b.failList = (p, off) => p === U && off === 1000;
    const h = harness(b);
    const r = await h.call();
    expect(r.body).toEqual({ error: "storage-list-failed" });
    expect(b.removeCalls).toHaveLength(0);
    expect(h.admin.auth.admin.deleteUser).not.toHaveBeenCalled();
  });

  it("R9 second remove batch fails -> 500, no DB delete, no deleteUser", async () => {
    const b = new TreeBucket(files(2500));
    b.failRemoveAt = 2;
    const h = harness(b);
    const r = await h.call();
    expect(r.body).toEqual({ error: "storage-delete-failed" });
    expect(b.removeCalls).toHaveLength(2);
    expect(h.order.some((x) => x.startsWith("db:"))).toBe(false);
    expect(h.admin.auth.admin.deleteUser).not.toHaveBeenCalled();
  });

  it("R10 remove reports success but objects remain -> storage-delete-incomplete", async () => {
    const b = new TreeBucket(files(3));
    b.removeIsNoop = true;
    const h = harness(b);
    const r = await h.call();
    expect(r.body).toEqual({ error: "storage-delete-incomplete" });
    expect(h.order.some((x) => x.startsWith("db:"))).toBe(false);
    expect(h.admin.auth.admin.deleteUser).not.toHaveBeenCalled();
  });

  it("R11 late object for a user with NO initial files is caught by the final check", async () => {
    const b = new TreeBucket();
    const h = harness(b, { onTable: (t) => t === "backups" && b.files.add(`${U}/late.pdf`) });
    const r = await h.call();
    expect(r.body).toEqual({ error: "storage-delete-incomplete" });
    expect(h.admin.auth.admin.deleteUser).not.toHaveBeenCalled();
  });

  it.each(["documents", "document_folders", "backups"])(
    "R12 DB error in %s stops later tables and deleteUser",
    async (t) => {
      const h = harness(new TreeBucket(files(1)), { failTable: t });
      const r = await h.call();
      expect(r.body).toEqual({ error: `data-delete-failed:${t}` });
      const tables = ["documents", "document_folders", "backups"];
      const after = tables.slice(tables.indexOf(t) + 1);
      for (const a of after) expect(h.order.some((x) => x.startsWith(`db:${a}`))).toBe(false);
      expect(h.admin.auth.admin.deleteUser).not.toHaveBeenCalled();
    },
  );

  it("R13 deleteUser error -> 500 auth-delete-failed", async () => {
    const r = await harness(new TreeBucket(), { failDeleteUser: true }).call();
    expect(r.status).toBe(500);
    expect(r.body).toEqual({ error: "auth-delete-failed" });
  });

  it("R14 missing user -> 401, no storage/DB access", async () => {
    const h = harness(new TreeBucket(files(2)), { noUser: true });
    const r = await h.call();
    expect(r.status).toBe(401);
    expect(h.order).toEqual([]);
  });

  it("R15 repeat call after success -> 401 not-signed-in, nothing touched again", async () => {
    const h = harness(new TreeBucket(files(2)));
    expect((await h.call()).status).toBe(200);
    const n = h.order.length;
    const r = await h.call();
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ error: "not-signed-in" });
    expect(h.order.length).toBe(n);
  });

  it("R16 foreign uid with colliding prefix is never listed or removed", async () => {
    const b = new TreeBucket([`${U}/a.pdf`, `${O}/b.pdf`, `${U}x/c.pdf`]);
    const h = harness(b);
    expect((await h.call()).status).toBe(200);
    expect([...b.files].sort()).toEqual([`${O}/b.pdf`, `${U}x/c.pdf`].sort());
    expect(b.listCalls.every((c) => c.path === U || c.path.startsWith(`${U}/`))).toBe(true);
    expect(b.removeCalls.flat().every((p) => p.startsWith(`${U}/`))).toBe(true);
  });

  it("R17 deleteUser is the very last step, after DB and final re-list", async () => {
    const h = harness(new TreeBucket([`${U}/a/b.pdf`]));
    await h.call();
    const last = h.order.length - 1;
    expect(h.order[last]).toBe(`deleteUser:${U}`);
    const iDb = h.order.lastIndexOf(`db:backups:user_id=${U}`);
    const iFinal = h.order.lastIndexOf(`list:${U}`);
    expect(iDb).toBeGreaterThan(h.order.indexOf("remove"));
    expect(iFinal).toBeGreaterThan(iDb);
    expect(last).toBeGreaterThan(iFinal);
  });

  it("R18 every failure body is a bare {error: code} JSON with CORS, no stack/internals", async () => {
    const cases = [
      harness(new TreeBucket(files(1)), { failTable: "documents" }),
      harness(new TreeBucket(), { failDeleteUser: true }),
      harness(new TreeBucket(files(1)), { noUser: true }),
    ];
    for (const h of cases) {
      const r = await h.call();
      expect(Object.keys(r.body)).toEqual(["error"]);
      expect(typeof r.body["error"]).toBe("string");
      expect(String(r.body["error"])).toMatch(/^[a-z:_-]+$/);
      expect(r.res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    }
  });
});
