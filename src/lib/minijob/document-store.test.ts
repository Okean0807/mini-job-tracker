import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createFakeIndexedDB, type FakeIdb } from "./__fixtures__/fake-indexeddb";
import {
  DocumentStore,
  DocumentStoreError,
  __setIndexedDbForTests,
  documentDbName,
  getDocumentStore,
  isValidDocumentId,
  newDocumentId,
  requestPersistentStorage,
  validateStoredDocument,
  type StoredDocument,
} from "./document-store";

let idb: FakeIdb;
let store: DocumentStore;
beforeEach(() => {
  idb = createFakeIndexedDB();
  store = new DocumentStore(idb.factory, "test-db");
});
afterEach(() => __setIndexedDbForTests(undefined));

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 1, 2, 3, 4, 5]); // synthetic bytes, not a real file
function doc(over: Partial<StoredDocument> = {}): StoredDocument {
  const blob = over.blob ?? new Blob([PDF], { type: "application/pdf" });
  return {
    id: over.id ?? newDocumentId(),
    name: "synthetic-contract.pdf",
    mimeType: "application/pdf",
    size: blob.size,
    category: "vertrag",
    jobId: null,
    folderId: null,
    tags: ["t1"],
    note: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    uploadedAt: "2026-11-04T10:00:00.000Z",
    ...over,
    blob,
  };
}
async function bytesOf(b: Blob) {
  return Array.from(new Uint8Array(await b.arrayBuffer()));
}
const code = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e: unknown) => (e instanceof DocumentStoreError ? e.code : "other"),
  );

describe("save, read, list, delete", () => {
  it("stores the Blob and its metadata and reads them back unchanged", async () => {
    const d = doc({ id: "id-1" });
    await store.add(d);
    const got = await store.get("id-1");
    expect(await bytesOf(got.blob)).toEqual(Array.from(PDF));
    expect({ ...got, blob: undefined }).toEqual({ ...d, blob: undefined });
    expect(got.size).toBe(PDF.length);
  });
  it("lists metadata (no Blob), newest upload first", async () => {
    await store.add(doc({ id: "a", uploadedAt: "2026-01-01T00:00:00.000Z" }));
    await store.add(doc({ id: "b", uploadedAt: "2026-03-01T00:00:00.000Z" }));
    const { docs, corrupt } = await store.list();
    expect(docs.map((d) => d.id)).toEqual(["b", "a"]);
    expect(corrupt).toBe(0);
    expect(Object.keys(docs[0] as object)).not.toContain("blob");
    expect(await store.count()).toBe(2);
    expect((await store.ids()).sort()).toEqual(["a", "b"]);
  });
  it("delete removes metadata and Blob together (one record, nothing left behind)", async () => {
    await store.add(doc({ id: "x" }));
    await store.delete("x");
    expect(await code(store.get("x"))).toBe("not-found");
    expect(idb.data.get("test-db")?.get("documents")?.size).toBe(0);
    await store.delete("x"); // deleting again is a no-op
  });
  it("generated ids are unique and valid", () => {
    const ids = new Set(Array.from({ length: 2000 }, () => newDocumentId()));
    expect(ids.size).toBe(2000);
    for (const id of ids) expect(isValidDocumentId(id)).toBe(true);
    for (const bad of ["", "a b", "../x", "x".repeat(65), 5, null])
      expect(isValidDocumentId(bad)).toBe(false);
  });
  it("update changes metadata only and keeps the Blob byte-identical", async () => {
    await store.add(doc({ id: "u" }));
    await store.update("u", { name: "renamed.pdf", tags: ["a", "b"], note: "n", jobId: "job1" });
    const got = await store.get("u");
    expect(got.name).toBe("renamed.pdf");
    expect(got.jobId).toBe("job1");
    expect(await bytesOf(got.blob)).toEqual(Array.from(PDF));
    expect(await code(store.update("missing", { name: "x" }))).toBe("not-found");
    expect(await code(store.update("u", { name: "" }))).toBe("invalid-record");
  });
});

describe("integrity and corrupt records", () => {
  it("duplicate id: add fails with duplicate-id and the original is untouched", async () => {
    await store.add(doc({ id: "d", name: "first.pdf" }));
    expect(await code(store.add(doc({ id: "d", name: "second.pdf" })))).toBe("duplicate-id");
    expect((await store.get("d")).name).toBe("first.pdf");
    expect(await store.count()).toBe(1);
  });
  it("rejects invalid records before touching the database", async () => {
    const bad: unknown[] = [
      doc({ id: "../x" }),
      doc({ name: "" }),
      doc({ mimeType: "text/html" }),
      doc({ size: 3 }), // size must equal blob.size
      doc({ blob: new Blob([]), size: 0 }),
      { ...doc(), tags: "x" },
      { ...doc(), blob: "not a blob" },
    ];
    for (const b of bad) expect(await code(store.add(b as StoredDocument))).toBe("invalid-record");
    expect(idb.opens).toBe(0);
  });
  it("a corrupt record is skipped by list() (and counted), refused by get(), and never deleted", async () => {
    await store.add(doc({ id: "ok" }));
    await store.count(); // db exists now
    idb.data.get("test-db")?.get("documents")?.set("broken", { id: "broken", name: "x" });
    idb.data
      .get("test-db")
      ?.get("documents")
      ?.set("noblob", { ...doc({ id: "noblob" }), blob: undefined });
    const { docs, corrupt } = await store.list();
    expect(docs.map((d) => d.id)).toEqual(["ok"]);
    expect(corrupt).toBe(2);
    expect(await code(store.get("broken"))).toBe("invalid-record");
    expect(idb.data.get("test-db")?.get("documents")?.size).toBe(3);
  });
  it("validateStoredDocument accepts exactly the allowed types and sizes", () => {
    expect(validateStoredDocument(doc())).not.toBeNull();
    for (const mimeType of ["image/jpeg", "image/png", "image/webp"])
      expect(validateStoredDocument(doc({ mimeType }))).not.toBeNull();
    expect(validateStoredDocument(doc({ mimeType: "application/zip" }))).toBeNull();
    expect(validateStoredDocument(null)).toBeNull();
    expect(validateStoredDocument("x")).toBeNull();
  });
});

describe("transactions and storage errors", () => {
  it("a quota error aborts the save: nothing is stored and the error is reported as quota", async () => {
    idb.faults.onWrite = () => "QuotaExceededError";
    expect(await code(store.add(doc({ id: "q" })))).toBe("quota");
    idb.faults.onWrite = undefined;
    expect(await store.count()).toBe(0);
    await store.add(doc({ id: "q" })); // retry works
    expect(await store.count()).toBe(1);
  });
  it("addMany is all-or-nothing (second write fails -> first write is rolled back)", async () => {
    let n = 0;
    idb.faults.onWrite = () => (++n === 2 ? "QuotaExceededError" : undefined);
    expect(await code(store.addMany([doc({ id: "1" }), doc({ id: "2" }), doc({ id: "3" })]))).toBe(
      "quota",
    );
    idb.faults.onWrite = undefined;
    expect(await store.count()).toBe(0);
    await store.addMany(
      [doc({ id: "1" }), doc({ id: "2" })],
      [{ id: "f1", name: "F", color: "#000" }],
    );
    expect(await store.count()).toBe(2);
    expect((await store.listFolders()).map((f) => f.id)).toEqual(["f1"]);
  });
  it("addMany with a duplicate id aborts everything", async () => {
    await store.add(doc({ id: "exists" }));
    expect(await code(store.addMany([doc({ id: "new" }), doc({ id: "exists" })]))).toBe(
      "duplicate-id",
    );
    expect((await store.ids()).sort()).toEqual(["exists"]);
  });
  it("an interrupted transaction (abort) never reports success and stores nothing", async () => {
    idb.faults.abortAfterFirstRequest = true;
    expect(await code(store.add(doc({ id: "i" })))).toBe("aborted");
    idb.faults.abortAfterFirstRequest = false;
    expect(await store.count()).toBe(0);
  });
  it("success is reported only after the transaction completed", async () => {
    let completedBeforeResolve = false;
    const p = store.add(doc({ id: "c" }));
    p.then(() => {
      completedBeforeResolve = idb.data.get("test-db")?.get("documents")?.has("c") === true;
    });
    await p;
    await Promise.resolve();
    expect(completedBeforeResolve).toBe(true);
  });
  it("IndexedDB unavailable (no factory / open fails / SecurityError) -> code unavailable, retry possible", async () => {
    expect(await code(new DocumentStore(undefined, "x").add(doc()))).toBe("unavailable");
    idb.faults.openError = "SecurityError";
    expect(await code(store.add(doc()))).toBe("unavailable");
    idb.faults.openError = undefined;
    await store.add(doc({ id: "after" })); // the failed open is not cached
    expect(await store.count()).toBe(1);
  });
  it("errors never contain names, ids or contents", async () => {
    idb.faults.onWrite = () => "QuotaExceededError";
    const e = await store
      .add(doc({ id: "secret-id", name: "secret-name.pdf" }))
      .catch((x: Error) => x);
    expect((e as Error).message).toBe("quota");
    expect(JSON.stringify(e)).not.toMatch(/secret/);
  });
});

describe("folders", () => {
  it("create, rename, list sorted; deleting a folder keeps its documents (moved to 'no folder')", async () => {
    await store.addFolder({ id: "f2", name: "Zeta", color: "#111" });
    await store.addFolder({ id: "f1", name: "Alpha", color: "#222" });
    expect((await store.listFolders()).map((f) => f.name)).toEqual(["Alpha", "Zeta"]);
    await store.updateFolder("f1", { name: "Alpha2" });
    expect((await store.listFolders())[0]?.name).toBe("Alpha2");
    await store.add(doc({ id: "d", folderId: "f1" }));
    await store.deleteFolder("f1");
    expect((await store.get("d")).folderId).toBeNull();
    expect((await store.listFolders()).map((f) => f.id)).toEqual(["f2"]);
    expect(await code(store.updateFolder("nope", { name: "x" }))).toBe("not-found");
  });
});

describe("rollback helper and scopes", () => {
  it("deleteMany removes exactly the given documents and folders (separate id spaces)", async () => {
    await store.addMany(
      [doc({ id: "a" }), doc({ id: "b" })],
      [{ id: "a", name: "same id, other store", color: "#000" }],
    );
    await store.deleteMany(["a"], []);
    expect(await store.ids()).toEqual(["b"]);
    expect((await store.listFolders()).map((f) => f.id)).toEqual(["a"]);
  });
  it("each storage scope has its own database", async () => {
    __setIndexedDbForTests(idb.factory);
    const { activateScope: switchLocalScope } = await import("./store");
    const { GUEST_SCOPE, DEMO_SCOPE } = await import("./storage-scope");
    switchLocalScope(GUEST_SCOPE);
    const guestName = documentDbName();
    await getDocumentStore().add(doc({ id: "g" }));
    switchLocalScope(DEMO_SCOPE);
    expect(documentDbName()).not.toBe(guestName);
    expect(await getDocumentStore().count()).toBe(0);
    switchLocalScope(GUEST_SCOPE);
    expect(await getDocumentStore().count()).toBe(1);
  });
});

describe("persistent storage request is best effort", () => {
  it("reports granted / denied / unsupported without claiming a guarantee", async () => {
    const nav = globalThis.navigator as unknown as { storage?: unknown };
    const orig = Object.getOwnPropertyDescriptor(nav, "storage");
    const set = (v: unknown) =>
      Object.defineProperty(nav, "storage", { value: v, configurable: true });
    set(undefined);
    expect(await requestPersistentStorage()).toBe("unsupported");
    set({ persist: async () => false, persisted: async () => false });
    expect(await requestPersistentStorage()).toBe("denied");
    set({ persist: async () => true, persisted: async () => false });
    expect(await requestPersistentStorage()).toBe("granted");
    set({
      persist: async () => {
        throw new Error("x");
      },
    });
    expect(await requestPersistentStorage()).toBe("unsupported");
    if (orig) Object.defineProperty(nav, "storage", orig);
  });
});
