import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeIndexedDB, type FakeIdb } from "./__fixtures__/fake-indexeddb";
import { __setIndexedDbForTests, getDocumentStore } from "./document-store";

// Public Local: the Documents functions run on IndexedDB; the cloud client must never be touched.
const h = vi.hoisted(() => ({ touched: [] as string[] }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: new Proxy(
    {},
    {
      get: (_t, p) => {
        h.touched.push(String(p));
        throw new Error("supabase touched");
      },
    },
  ),
}));

import * as docs from "./documents";

let idb: FakeIdb;
beforeEach(() => {
  vi.stubEnv("VITE_CLOUD_SYNC_ENABLED", "false");
  idb = createFakeIndexedDB();
  __setIndexedDbForTests(idb.factory);
  h.touched.length = 0;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  __setIndexedDbForTests(undefined);
});

const pdf = (n = 100, name = "synthetic.pdf") =>
  new File([new Uint8Array(n).fill(7)], name, {
    type: "application/pdf",
    lastModified: Date.UTC(2026, 0, 5),
  });
const meta = { category: "vertrag", tags: ["a"] };
const errCode = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e: { code?: string }) => e.code ?? "other",
  );

describe("upload / list / open / delete on the device", () => {
  it("stores the file and lists it as a Documents row (no cloud client involved)", async () => {
    await docs.uploadDocument(pdf(120, "contract.pdf"), { ...meta, jobId: "j1", note: "n" });
    const rows = await docs.listDocuments();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "contract.pdf",
      size: 120,
      mime_type: "application/pdf",
      category: "vertrag",
      job_id: "j1",
      folder_id: null,
      tags: ["a"],
      note: "n",
    });
    expect(rows[0]?.path).toBe(rows[0]?.id);
    const rec = await getDocumentStore().get(rows[0]!.id);
    expect(rec.createdAt).toBe("2026-01-05T00:00:00.000Z"); // original file time kept separately from the upload time
    expect(rec.uploadedAt).not.toBe(rec.createdAt);
    expect(rec.blob.size).toBe(120);
    expect(h.touched).toEqual([]);
  });
  it("keeps the 20 MiB limit and the type whitelist (nothing stored when refused)", async () => {
    expect(
      await errCode(
        docs.uploadDocument(
          new File([new Uint8Array(20 * 1024 * 1024 + 1)], "big.pdf", { type: "application/pdf" }),
          meta,
        ),
      ),
    ).toBe("file-too-large");
    expect(
      await errCode(
        docs.uploadDocument(new File([], "empty.pdf", { type: "application/pdf" }), meta),
      ),
    ).toBe("file-too-large");
    expect(
      await errCode(
        docs.uploadDocument(new File([new Uint8Array(5)], "a.html", { type: "text/html" }), meta),
      ),
    ).toBe("file-type-not-allowed");
    expect((await docs.listDocuments()).length).toBe(0);
    await docs.uploadDocument(
      new File([new Uint8Array(20 * 1024 * 1024)], "edge.pdf", { type: "application/pdf" }),
      meta,
    );
    expect((await docs.listDocuments()).length).toBe(1);
  }, 30_000);
  it("quota error: the user gets 'storage-full', no record exists and the same upload can be retried", async () => {
    idb.faults.onWrite = () => "QuotaExceededError";
    expect(await errCode(docs.uploadDocument(pdf(), meta))).toBe("storage-full");
    expect((await docs.listDocuments()).length).toBe(0);
    idb.faults.onWrite = undefined;
    await docs.uploadDocument(pdf(), meta);
    expect((await docs.listDocuments()).length).toBe(1);
  });
  it("IndexedDB unavailable: 'storage-unavailable'; other failures: 'storage-failed'", async () => {
    __setIndexedDbForTests(null);
    expect(await errCode(docs.uploadDocument(pdf(), meta))).toBe("storage-unavailable");
    __setIndexedDbForTests(idb.factory);
    idb.faults.onWrite = () => "UnknownError";
    expect(await errCode(docs.uploadDocument(pdf(), meta))).toBe("storage-failed");
  });
  it("a duplicate generated id is retried with a fresh id; the existing document is untouched", async () => {
    const spy = vi.spyOn(globalThis.crypto, "randomUUID");
    spy
      .mockReturnValueOnce("11111111-1111-4111-8111-111111111111")
      .mockReturnValueOnce("11111111-1111-4111-8111-111111111111");
    await docs.uploadDocument(pdf(10, "first.pdf"), meta);
    await docs.uploadDocument(pdf(20, "second.pdf"), meta);
    const rows = await docs.listDocuments();
    expect(rows.map((r) => r.name).sort()).toEqual(["first.pdf", "second.pdf"]);
    expect(new Set(rows.map((r) => r.id)).size).toBe(2);
    expect(rows.find((r) => r.name === "first.pdf")?.size).toBe(10);
  });
  it("open gives a temporary Blob URL of the stored bytes; download uses the original file name", async () => {
    await docs.uploadDocument(pdf(33, "orig-name.pdf"), meta);
    const row = (await docs.listDocuments())[0]!;
    const create = vi.fn(() => "blob:test");
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    expect(await docs.documentUrl(row.path)).toBe("blob:test");
    expect((create.mock.calls[0] as unknown as [Blob])[0].size).toBe(33);
    const clicks: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicks.push(this.download);
    });
    await docs.downloadLocalDocument(row);
    expect(clicks).toEqual(["orig-name.pdf"]);
    expect(await errCode(docs.documentUrl("missing-id"))).toBe("not-found");
  });
  it("delete removes the record; metadata and Blob are gone together", async () => {
    await docs.uploadDocument(pdf(), meta);
    const row = (await docs.listDocuments())[0]!;
    await docs.deleteDocument(row);
    expect(await docs.listDocuments()).toEqual([]);
    expect(idb.data.values().next().value?.get("documents")?.size).toBe(0);
  });
  it("update keeps the file; folders: create / rename / delete keeps documents", async () => {
    await docs.createFolder("Verträge", "#0d9488");
    const folder = (await docs.listFolders())[0]!;
    await docs.uploadDocument(pdf(), { ...meta, folderId: folder.id });
    const row = (await docs.listDocuments())[0]!;
    await docs.updateDocument(row.id, { name: "renamed.pdf", note: "x", tags: ["z"] });
    await docs.updateFolder(folder.id, { name: "Neu" });
    expect((await docs.listFolders())[0]?.name).toBe("Neu");
    expect((await docs.listDocuments())[0]).toMatchObject({
      name: "renamed.pdf",
      note: "x",
      tags: ["z"],
      size: 100,
    });
    await docs.deleteFolder(folder.id);
    expect((await docs.listDocuments())[0]?.folder_id).toBeNull();
  });
  it("corrupt records are not listed, counted, and never deleted", async () => {
    await docs.uploadDocument(pdf(), meta);
    idb.data.values().next().value?.get("documents")?.set("junk", { id: "junk" });
    expect((await docs.listDocuments()).length).toBe(1);
    expect(docs.localCorruptDocumentCount()).toBe(1);
    expect(idb.data.values().next().value?.get("documents")?.has("junk")).toBe(true);
  });
  it("persistent storage is requested after a successful save and only reported, never assumed", async () => {
    const persist = vi.fn(async () => false);
    Object.defineProperty(globalThis.navigator, "storage", {
      value: { persist, persisted: async () => false },
      configurable: true,
    });
    await docs.uploadDocument(pdf(), meta);
    await new Promise((r) => setTimeout(r, 10));
    expect(persist).toHaveBeenCalledTimes(1);
    expect(docs.lastPersistenceResult()).toBe("denied");
  });
});

describe("cloud build is unchanged", () => {
  it("with the cloud flag ON the documents functions use the cloud client, not IndexedDB", async () => {
    vi.stubEnv("VITE_CLOUD_SYNC_ENABLED", "true");
    await expect(docs.listDocuments()).rejects.toThrow(/supabase touched/);
    expect(h.touched.length).toBeGreaterThan(0);
    expect(idb.opens).toBe(0);
  });
});
