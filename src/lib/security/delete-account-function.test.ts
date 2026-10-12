import { describe, expect, it, vi } from "vitest";

import {
  type AdminClientLike,
  type StorageBucketLike,
  type StorageListItem,
  handleDeleteAccount,
  listAllUserObjectPaths,
  removeInBatches,
} from "../../../supabase/functions/delete-account/handler.ts";

// In-memory fake of a Storage bucket that mimics storage-js list():
// direct children only, folders as { id: null }, files with an id,
// sorted by name, paginated by limit/offset. No network access.
class FakeBucket implements StorageBucketLike {
  files = new Set<string>();
  emptyFolders = new Set<string>();
  listCalls: { path: string; limit: number; offset: number }[] = [];
  removeCalls: string[][] = [];
  failListFor = new Set<string>();
  failRemoveCallNo: number | null = null;

  constructor(paths: string[] = []) {
    paths.forEach((p) => this.files.add(p));
  }

  async list(path: string, options: { limit: number; offset: number }) {
    this.listCalls.push({ path, limit: options.limit, offset: options.offset });
    if (this.failListFor.has(path)) return { data: null, error: new Error("boom") };
    const prefix = `${path}/`;
    const children = new Map<string, StorageListItem>();
    for (const f of this.files) {
      if (!f.startsWith(prefix)) continue;
      const rest = f.slice(prefix.length);
      const [head, ...tail] = rest.split("/");
      children.set(head!, { name: head!, id: tail.length ? null : `id:${f}` });
    }
    for (const d of this.emptyFolders) {
      if (!d.startsWith(prefix)) continue;
      const head = d.slice(prefix.length).split("/")[0]!;
      if (!children.has(head)) children.set(head, { name: head, id: null });
    }
    const sorted = [...children.values()].sort((a, b) => a.name.localeCompare(b.name));
    return { data: sorted.slice(options.offset, options.offset + options.limit), error: null };
  }

  async remove(paths: string[]) {
    this.removeCalls.push(paths);
    if (this.failRemoveCallNo === this.removeCalls.length)
      return { data: null, error: new Error("rm") };
    paths.forEach((p) => this.files.delete(p));
    return { data: paths.map((name) => ({ name })), error: null };
  }
}

const USER = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

function makeAdmin(
  bucket: FakeBucket,
  opts: {
    userError?: boolean;
    userAndError?: boolean;
    throwIn?: "getUser" | "db" | "deleteUser" | "storage";
    onDbDelete?: (table: string) => void;
    failTable?: string;
    failAuthDelete?: boolean;
  } = {},
) {
  const calls: string[] = [];
  const admin: AdminClientLike = {
    auth: {
      getUser: vi.fn(async (token: string) => {
        if (opts.throwIn === "getUser") throw new Error("network down SECRET_INTERNAL");
        // Off-contract (auth-js says error => user null): defense in depth.
        if (opts.userAndError) return { data: { user: { id: USER } }, error: new Error("auth") };
        return opts.userError || token !== "good-token"
          ? { data: { user: null }, error: opts.userError ? new Error("auth") : null }
          : { data: { user: { id: USER } }, error: null };
      }),
      admin: {
        deleteUser: vi.fn(async (id: string) => {
          if (opts.throwIn === "deleteUser") throw new Error("boom SECRET_INTERNAL");
          calls.push(`deleteUser:${id}`);
          return { error: opts.failAuthDelete ? new Error("x") : null };
        }),
      },
    },
    storage: {
      from: () => {
        if (opts.throwIn === "storage") throw new Error("boom SECRET_INTERNAL");
        return bucket;
      },
    },
    from: (table: string) => ({
      delete: () => ({
        eq: async (col: string, val: string) => {
          if (opts.throwIn === "db") throw new Error("boom SECRET_INTERNAL");
          calls.push(`delete:${table}:${col}=${val}`);
          opts.onDbDelete?.(table);
          return { error: opts.failTable === table ? new Error("db") : null };
        },
      }),
    }),
  };
  return { admin, calls };
}

const env = (n: string) =>
  ({ SUPABASE_URL: "http://local.test", SUPABASE_SERVICE_ROLE_KEY: "test-key" })[n];
const post = (auth?: string) =>
  new Request("http://local.test/delete-account", {
    method: "POST",
    headers: auth ? { Authorization: auth } : {},
  });

async function run(
  bucket: FakeBucket,
  opts: Parameters<typeof makeAdmin>[1] = {},
  auth = "Bearer good-token",
) {
  const { admin, calls } = makeAdmin(bucket, opts);
  const res = await handleDeleteAccount(post(auth), { getEnv: env, createAdmin: () => admin });
  return { res, body: (await res.json()) as Record<string, unknown>, calls, admin };
}

const many = (n: number, dir = USER) =>
  Array.from({ length: n }, (_, i) => `${dir}/f${String(i).padStart(5, "0")}.pdf`);

// Verbatim listing logic of supabase/functions/delete-account/index.ts @ e209fe8
// (top level only). Used to prove the tests detect the original defect.
async function legacyTopLevelPaths(bucket: StorageBucketLike, userId: string) {
  const paths: string[] = [];
  let offset = 0;
  for (;;) {
    const { data } = await bucket.list(userId, {
      limit: 1000,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    const page = (data ?? []).filter((o) => o.name).map((o) => `${userId}/${o.name}`);
    paths.push(...page);
    if (page.length < 1000) break;
    offset += 1000;
  }
  return paths;
}

describe("delete-account: recursive storage listing", () => {
  it("regression: legacy top-level logic misses nested file, new logic finds it", async () => {
    const b = new FakeBucket([`${USER}/a/nested.pdf`]);
    const legacy = await legacyTopLevelPaths(b, USER);
    expect(legacy).toEqual([`${USER}/a`]); // folder name, not the file
    expect(legacy).not.toContain(`${USER}/a/nested.pdf`);
    expect(await listAllUserObjectPaths(b, USER)).toEqual([`${USER}/a/nested.pdf`]);
  });

  it("1. no storage files: no remove call, account deleted", async () => {
    const b = new FakeBucket();
    const { res, calls } = await run(b);
    expect(res.status).toBe(200);
    expect(b.removeCalls).toHaveLength(0);
    expect(calls.at(-1)).toBe(`deleteUser:${USER}`);
  });

  it("2. one root file", async () => {
    const b = new FakeBucket([`${USER}/doc.pdf`]);
    const { res } = await run(b);
    expect(res.status).toBe(200);
    expect(b.removeCalls).toEqual([[`${USER}/doc.pdf`]]);
    expect(b.files.size).toBe(0);
  });

  it("3. file one level deep", async () => {
    const b = new FakeBucket([`${USER}/folder/doc.pdf`]);
    expect((await run(b)).res.status).toBe(200);
    expect(b.removeCalls.flat()).toEqual([`${USER}/folder/doc.pdf`]);
  });

  it("4. several nesting levels, mixed files/folders in one response, extension-less files", async () => {
    const paths = [
      `${USER}/README`,
      `${USER}/a/x.pdf`,
      `${USER}/a/b/c/d/deep`,
      `${USER}/a/b/y.png`,
    ];
    const b = new FakeBucket(paths);
    expect((await listAllUserObjectPaths(b, USER)).sort()).toEqual([...paths].sort());
    expect((await run(b)).res.status).toBe(200);
    expect(b.files.size).toBe(0);
  });

  it("5. empty folders are traversed without error", async () => {
    const b = new FakeBucket([`${USER}/keep/a.pdf`]);
    b.emptyFolders.add(`${USER}/empty`);
    b.emptyFolders.add(`${USER}/keep/empty2`);
    expect(await listAllUserObjectPaths(b, USER)).toEqual([`${USER}/keep/a.pdf`]);
    expect((await run(b)).res.status).toBe(200);
  });

  it("6. multiple listing pages (offset loop until short page)", async () => {
    const b = new FakeBucket(many(5));
    const found = await listAllUserObjectPaths(b, USER, 2);
    expect(found).toHaveLength(5);
    expect(b.listCalls.map((c) => c.offset)).toEqual([0, 2, 4]);
  });

  it("7. exactly 1000 files: one remove batch, extra empty list page", async () => {
    const b = new FakeBucket(many(1000));
    expect((await run(b)).res.status).toBe(200);
    expect(b.removeCalls.map((c) => c.length)).toEqual([1000]);
  });

  it("8. more than 1000 files across folders: several batches of <= 1000", async () => {
    const b = new FakeBucket([...many(1500), ...many(700, `${USER}/sub`)]);
    expect((await run(b)).res.status).toBe(200);
    expect(b.removeCalls.map((c) => c.length)).toEqual([1000, 1000, 200]);
    expect(b.files.size).toBe(0);
  });

  it("9. listing error in a nested folder aborts before any delete", async () => {
    const b = new FakeBucket([`${USER}/a.pdf`, `${USER}/sub/b.pdf`]);
    b.failListFor.add(`${USER}/sub`);
    const { res, body, calls } = await run(b);
    expect(res.status).toBe(500);
    expect(body["error"]).toBe("storage-list-failed");
    expect(b.removeCalls).toHaveLength(0);
    expect(calls).toEqual([]);
  });

  it("10. remove error in one batch: non-2xx, DB rows and auth user untouched", async () => {
    const b = new FakeBucket(many(2500));
    b.failRemoveCallNo = 2;
    const { res, body, calls } = await run(b);
    expect(res.status).toBe(500);
    expect(body["error"]).toBe("storage-delete-failed");
    expect(b.removeCalls).toHaveLength(2);
    expect(calls).toEqual([]);
  });

  it("11. partial delete then re-run removes the remainder idempotently", async () => {
    const b = new FakeBucket([...many(1200), `${USER}/n/deep.pdf`]);
    b.failRemoveCallNo = 2;
    expect((await run(b)).res.status).toBe(500);
    expect(b.files.size).toBe(201);
    b.failRemoveCallNo = null;
    b.removeCalls = [];
    const second = await run(b);
    expect(second.res.status).toBe(200);
    expect(b.removeCalls.flat()).toHaveLength(201);
    expect(b.files.size).toBe(0);
  });

  it("11b. objects remaining after remove are reported, not claimed as success", async () => {
    const b = new FakeBucket([`${USER}/a.pdf`]);
    b.remove = async (paths: string[]) => {
      b.removeCalls.push(paths);
      return { data: [], error: null }; // silently removes nothing
    };
    const { res, body, calls } = await run(b);
    expect(res.status).toBe(500);
    expect(body["error"]).toBe("storage-delete-incomplete");
    expect(calls).toEqual([]);
  });

  it.each([[undefined], ["Basic abc"], ["Bearer "], ["Bearer wrong-token"]])(
    "12. missing/invalid bearer (%s) -> 401, nothing deleted",
    async (auth) => {
      const b = new FakeBucket([`${USER}/a.pdf`]);
      const { admin, calls } = makeAdmin(b);
      const res = await handleDeleteAccount(post(auth), { getEnv: env, createAdmin: () => admin });
      expect(res.status).toBe(401);
      expect(b.removeCalls).toHaveLength(0);
      expect(calls).toEqual([]);
    },
  );

  it("13. auth.getUser error -> 401, nothing deleted", async () => {
    const b = new FakeBucket([`${USER}/a.pdf`]);
    const { res, calls } = await run(b, { userError: true });
    expect(res.status).toBe(401);
    expect(b.listCalls).toHaveLength(0);
    expect(calls).toEqual([]);
  });

  it("14. other user's objects are never listed or removed", async () => {
    const b = new FakeBucket([
      `${USER}/a.pdf`,
      `${OTHER}/secret.pdf`,
      `${OTHER}/x/y.pdf`,
      `${USER}x/near.pdf`,
    ]);
    expect((await run(b)).res.status).toBe(200);
    expect(b.listCalls.every((c) => c.path === USER || c.path.startsWith(`${USER}/`))).toBe(true);
    expect([...b.files].sort()).toEqual(
      [`${OTHER}/secret.pdf`, `${OTHER}/x/y.pdf`, `${USER}x/near.pdf`].sort(),
    );
  });

  it("14b. traversal names from the API ('..', '/') are rejected", async () => {
    for (const name of ["..", "a/b", ""]) {
      const b = new FakeBucket();
      b.list = async () => ({ data: [{ name, id: "1" }], error: null });
      await expect(listAllUserObjectPaths(b, USER)).rejects.toThrow("storage-path-invalid");
    }
    await expect(removeInBatches(new FakeBucket(), USER, [`${OTHER}/a`])).rejects.toThrow(
      "storage-path-invalid",
    );
    await expect(
      removeInBatches(new FakeBucket(), USER, [`${USER}/../${OTHER}/a`]),
    ).rejects.toThrow("storage-path-invalid");
  });

  it("14c. self-referencing folder listing terminates (depth guard)", async () => {
    const b = new FakeBucket();
    b.list = async () => ({ data: [{ name: "loop", id: null }], error: null });
    await expect(listAllUserObjectPaths(b, USER)).rejects.toThrow("storage-list-too-deep");
  });

  it("15. DB delete error -> 500, auth user kept, order preserved", async () => {
    const b = new FakeBucket([`${USER}/a.pdf`]);
    const { res, body, calls } = await run(b, { failTable: "document_folders" });
    expect(res.status).toBe(500);
    expect(body["error"]).toBe("data-delete-failed:document_folders");
    expect(calls).toEqual([
      `delete:documents:user_id=${USER}`,
      `delete:document_folders:user_id=${USER}`,
    ]);
  });

  it("16. auth deleteUser error -> 500; full order documents, folders, backups, user", async () => {
    const b = new FakeBucket([`${USER}/a.pdf`]);
    const { res, body, calls } = await run(b, { failAuthDelete: true });
    expect(res.status).toBe(500);
    expect(body["error"]).toBe("auth-delete-failed");
    expect(calls).toEqual([
      `delete:documents:user_id=${USER}`,
      `delete:document_folders:user_id=${USER}`,
      `delete:backups:user_id=${USER}`,
      `deleteUser:${USER}`,
    ]);
  });

  it("17. CORS preflight and headers; non-POST rejected; missing env", async () => {
    const createAdmin = vi.fn();
    const pre = await handleDeleteAccount(new Request("http://l/x", { method: "OPTIONS" }), {
      getEnv: env,
      createAdmin,
    });
    expect(pre.status).toBe(200);
    expect(pre.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(pre.headers.get("Access-Control-Allow-Headers")).toContain("authorization");
    const get = await handleDeleteAccount(new Request("http://l/x", { method: "GET" }), {
      getEnv: env,
      createAdmin,
    });
    expect(get.status).toBe(405);
    expect(get.headers.get("Access-Control-Allow-Origin")).toBe("*");
    const noEnv = await handleDeleteAccount(post("Bearer good-token"), {
      getEnv: () => undefined,
      createAdmin,
    });
    expect(noEnv.status).toBe(500);
    expect(createAdmin).not.toHaveBeenCalled();
  });

  describe("hardening round 2", () => {
    it("A1. prefix collision: uid 'abc' never touches 'abc2/' or 'abc-x/'", async () => {
      const b = new FakeBucket(["abc/a.pdf", "abc/d/b.pdf", "abc2/c.pdf", "abc-x/d.pdf"]);
      expect((await listAllUserObjectPaths(b, "abc")).sort()).toEqual(["abc/a.pdf", "abc/d/b.pdf"]);
      expect(b.listCalls.every((c) => c.path === "abc" || c.path.startsWith("abc/"))).toBe(true);
      for (const bad of ["abc2/c.pdf", "abc-x/d.pdf", "abc", "abcd"]) {
        const rb = new FakeBucket([bad]);
        await expect(removeInBatches(rb, "abc", ["abc/ok.pdf", bad])).rejects.toThrow(
          "storage-path-invalid",
        );
        expect(rb.removeCalls).toHaveLength(0);
      }
      await removeInBatches(b, "abc", ["abc/a.pdf"]);
      expect(b.removeCalls).toEqual([["abc/a.pdf"]]);
    });

    it("A2. getUser returning user AND error is rejected (401, nothing deleted)", async () => {
      const b = new FakeBucket([`${USER}/a.pdf`]);
      const { res, calls } = await run(b, { userAndError: true });
      expect(res.status).toBe(401);
      expect(b.listCalls).toHaveLength(0);
      expect(calls).toEqual([]);
    });

    it.each([
      [undefined],
      ["Bearer"],
      ["Bearer "],
      ["Bearer   "],
      ["bearer good-token"],
      ["Basic good-token"],
      ["Token good-token"],
    ])("A3. Authorization %j -> 401 before any client is created", async (auth) => {
      const createAdmin = vi.fn();
      const res = await handleDeleteAccount(post(auth), { getEnv: env, createAdmin });
      expect(res.status).toBe(401);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(createAdmin).not.toHaveBeenCalled();
    });

    it.each(["getUser", "storage", "db", "deleteUser"] as const)(
      "B. unexpected throw in %s -> generic JSON 500 with CORS, no internals",
      async (where) => {
        const b = new FakeBucket([`${USER}/a.pdf`]);
        const { res, body, admin } = await run(b, { throwIn: where });
        expect(res.status).toBe(500);
        expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
        expect(res.headers.get("Content-Type")).toBe("application/json");
        // storage throws are caught by the cleanup try and mapped to the generic storage code
        expect(body).toEqual({
          error: where === "storage" ? "storage-delete-failed" : "internal-error",
        });
        expect(JSON.stringify(body)).not.toContain("SECRET_INTERNAL");
        if (where !== "deleteUser") expect(admin.auth.admin.deleteUser).not.toHaveBeenCalled();
      },
    );

    it("B2. createAdmin throwing -> generic JSON 500", async () => {
      const res = await handleDeleteAccount(post("Bearer good-token"), {
        getEnv: env,
        createAdmin: () => {
          throw new Error("bad url SECRET_INTERNAL");
        },
      });
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: "internal-error" });
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    });

    it("C. object uploaded during DB cleanup -> abort before deleteUser, retry succeeds", async () => {
      const b = new FakeBucket([`${USER}/a.pdf`]);
      let injected = false;
      const onDbDelete = (table: string) => {
        if (table === "backups" && !injected) {
          injected = true;
          b.files.add(`${USER}/late/upload.pdf`);
        }
      };
      const first = await run(b, { onDbDelete });
      expect(first.res.status).toBe(500);
      expect(first.body["error"]).toBe("storage-delete-incomplete");
      expect(first.admin.auth.admin.deleteUser).not.toHaveBeenCalled();
      const second = await run(b, { onDbDelete });
      expect(second.res.status).toBe(200);
      expect(b.files.size).toBe(0);
    });

    it("C2. list error in the pre-deleteUser check aborts with non-2xx", async () => {
      const b = new FakeBucket();
      const { admin } = makeAdmin(b, {
        onDbDelete: (t) => t === "backups" && b.failListFor.add(USER),
      });
      const res = await handleDeleteAccount(post("Bearer good-token"), {
        getEnv: env,
        createAdmin: () => admin,
      });
      expect(res.status).toBe(500);
      expect(admin.auth.admin.deleteUser).not.toHaveBeenCalled();
    });
  });
});
