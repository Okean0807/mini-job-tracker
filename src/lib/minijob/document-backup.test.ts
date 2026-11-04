import { beforeEach, describe, expect, it } from "vitest";

import { createFakeIndexedDB, type FakeIdb } from "./__fixtures__/fake-indexeddb";
import {
  BACKUP_VERSION,
  BackupError,
  commitRestore,
  exportBackup,
  prepareRestore,
  type BackupManifest,
  type RestoreDeps,
  type RestorePlan,
} from "./document-backup";
import { DocumentStore, type StoredDocument } from "./document-store";
import type { AppData } from "./types";
import { buildZip, crc32, openZip } from "./zip-store";

let idb: FakeIdb;
let store: DocumentStore;
beforeEach(() => {
  idb = createFakeIndexedDB();
  store = new DocumentStore(idb.factory, "bk");
});

const DATA = {
  shifts: [{ id: "s1", date: "2026-11-01" }],
  jobs: [{ id: "j1", name: "Synthetic Job" }],
  settings: { language: "en" },
} as unknown as AppData;
const OTHER = {
  shifts: [],
  jobs: [{ id: "jx", name: "Other" }],
  settings: {},
} as unknown as AppData;
const NOW = new Date("2026-11-04T12:00:00.000Z");
const fileBytes = (seed: number, n = 300) =>
  new Uint8Array(n).map((_, i) => (i * seed + seed) % 256);
function doc(id: string, seed: number, over: Partial<StoredDocument> = {}): StoredDocument {
  const blob = over.blob ?? new Blob([fileBytes(seed)], { type: "application/pdf" });
  return {
    id,
    name: `synthetic-${id}.pdf`,
    mimeType: "application/pdf",
    size: blob.size,
    category: "vertrag",
    jobId: "j1",
    folderId: null,
    tags: ["x"],
    note: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    uploadedAt: "2026-02-01T00:00:00.000Z",
    ...over,
    blob,
  };
}
const bytesOf = async (b: Blob) => Array.from(new Uint8Array(await b.arrayBuffer()));
const enc = (v: unknown) =>
  new Blob([new TextEncoder().encode(typeof v === "string" ? v : JSON.stringify(v))]);

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return e instanceof BackupError ? e.code : "other:" + String(e);
  }
}

/** Builds a syntactically valid v2 archive from a manifest + extra control. */
async function archive(
  manifestPatch: (m: BackupManifest) => void = () => undefined,
  opts: { omit?: string[]; extra?: [string, Blob][]; data?: unknown; docs?: StoredDocument[] } = {},
): Promise<Blob> {
  const docs = opts.docs ?? [doc("d1", 3), doc("d2", 5)];
  const dataBlob = enc(opts.data ?? DATA);
  const manifest: BackupManifest = {
    format: "minijob-backup",
    version: BACKUP_VERSION,
    createdAt: NOW.toISOString(),
    app: {
      file: "data.json",
      size: dataBlob.size,
      crc: crc32(new Uint8Array(await dataBlob.arrayBuffer())),
    },
    counts: {
      documents: docs.length,
      folders: 0,
      totalBytes: docs.reduce((n, d) => n + d.size, 0),
    },
    documents: await Promise.all(
      docs.map(async (d) => {
        const { blob, ...m } = d;
        return {
          ...m,
          file: `documents/${d.id}`,
          crc: crc32(new Uint8Array(await blob.arrayBuffer())),
        };
      }),
    ),
    folders: [],
  };
  manifestPatch(manifest);
  const entries: { name: string; data: Blob }[] = [
    { name: "manifest.json", data: enc(manifest) },
    { name: "data.json", data: dataBlob },
  ];
  for (const d of docs)
    if (!(opts.omit ?? []).includes(d.id))
      entries.push({ name: `documents/${d.id}`, data: d.blob });
  for (const [name, data] of opts.extra ?? []) entries.push({ name, data });
  return buildZip(entries);
}

describe("export", () => {
  it("without documents: the plain JSON backup of the earlier versions (unchanged format)", async () => {
    const r = await exportBackup(DATA, { store, now: NOW });
    expect(r.kind).toBe("json");
    expect(r.filename).toBe("minijob-backup-2026-11-04.json");
    expect(JSON.parse(await r.blob.text())).toEqual(DATA);
    expect(r.documents).toBe(0);
  });
  it("with one document: a ZIP with manifest, data and the original bytes", async () => {
    await store.add(doc("d1", 7));
    const r = await exportBackup(DATA, { store, now: NOW });
    expect(r.kind).toBe("zip");
    expect(r.filename).toBe("minijob-backup-2026-11-04.zip");
    const z = await openZip(r.blob, { maxEntryBytes: 1e8, maxTotalBytes: 1e9 });
    expect(z.entries.map((e) => e.name).sort()).toEqual([
      "data.json",
      "documents/d1",
      "manifest.json",
    ]);
    const m = JSON.parse(await (await z.read("manifest.json")).text()) as BackupManifest;
    expect(m.format).toBe("minijob-backup");
    expect(m.version).toBe(2);
    expect(m.counts).toEqual({ documents: 1, folders: 0, totalBytes: 300 });
    expect(m.documents[0]).toMatchObject({
      id: "d1",
      name: "synthetic-d1.pdf",
      mimeType: "application/pdf",
      size: 300,
      jobId: "j1",
      category: "vertrag",
      file: "documents/d1",
    });
    expect(await bytesOf(await z.read("documents/d1"))).toEqual(Array.from(fileBytes(7)));
    expect(JSON.parse(await (await z.read("data.json")).text())).toEqual(DATA);
  });
  it("with several documents and a folder: counts and sizes add up", async () => {
    await store.addMany(
      [
        doc("a", 1, { folderId: "f" }),
        doc("b", 2, { size: 50, blob: new Blob([fileBytes(2, 50)], { type: "application/pdf" }) }),
        doc("c", 4),
      ],
      [{ id: "f", name: "Folder", color: "#000" }],
    );
    const r = await exportBackup(DATA, { store, now: NOW });
    const m = JSON.parse(
      await (
        await (
          await openZip(r.blob, { maxEntryBytes: 1e8, maxTotalBytes: 1e9 })
        ).read("manifest.json")
      ).text(),
    ) as BackupManifest;
    expect(m.counts).toEqual({ documents: 3, folders: 1, totalBytes: 650 });
    expect(m.folders).toEqual([{ id: "f", name: "Folder", color: "#000" }]);
  });
  it("is reproducible: the same state exports byte-identical archives", async () => {
    await store.add(doc("d1", 7));
    const a = await exportBackup(DATA, { store, now: NOW });
    const b = await exportBackup(DATA, { store, now: NOW });
    expect(await bytesOf(a.blob)).toEqual(await bytesOf(b.blob));
  });
  it("corrupt stored records are not exported, are reported and are never deleted", async () => {
    await store.add(doc("ok", 1));
    idb.data.get("bk")?.get("documents")?.set("bad", { id: "bad" });
    const r = await exportBackup(DATA, { store, now: NOW });
    expect(r.skippedCorrupt).toBe(1);
    expect(r.documents).toBe(1);
    expect(idb.data.get("bk")?.get("documents")?.has("bad")).toBe(true);
  });
  it("never produces a silently incomplete backup when the document store cannot be read", async () => {
    await store.add(doc("d1", 1));
    idb.faults.openError = "SecurityError";
    const broken = new DocumentStore(idb.factory, "bk2");
    expect(await codeOf(exportBackup(DATA, { store: broken, now: NOW }))).toBe(
      "storage-unavailable",
    );
  });
  it("withDocuments=false (cloud build) keeps the JSON backup even if local records exist", async () => {
    await store.add(doc("d1", 1));
    expect((await exportBackup(DATA, { store, now: NOW, withDocuments: false })).kind).toBe("json");
  });
});

describe("import: formats", () => {
  it("an old JSON backup (no documents) is recognised as 'json' and left to the existing restore path", async () => {
    expect(await prepareRestore(enc(DATA))).toEqual({ kind: "json" });
    expect(await prepareRestore(new Blob(["not json at all"]))).toEqual({ kind: "json" });
    expect(await prepareRestore(new Blob([]))).toEqual({ kind: "json" });
  });
  it("a new backup with documents validates, restores byte-identical files and reports a preview", async () => {
    await store.add(doc("d1", 7));
    await store.add(doc("d2", 9, { folderId: "f1" }));
    const exp = await exportBackup(DATA, { store, now: NOW });
    const plan = await prepareRestore(exp.blob, { store: new DocumentStore(idb.factory, "fresh") });
    expect(plan.kind).toBe("zip");
    if (plan.kind !== "zip") return;
    expect(plan.summary).toMatchObject({
      documents: 2,
      totalBytes: 600,
      shifts: 1,
      jobs: 1,
      alreadyPresent: 0,
      toAdd: 2,
    });
    expect(plan.data).toEqual(DATA);
    expect(
      await bytesOf((plan.documents.find((d) => d.id === "d1") as StoredDocument).blob),
    ).toEqual(Array.from(fileBytes(7)));
    expect(plan.documents.find((d) => d.id === "d2")).toMatchObject({
      mimeType: "application/pdf",
      jobId: "j1",
      folderId: "f1",
      uploadedAt: "2026-02-01T00:00:00.000Z",
    });
  });
  it("preparing a restore writes nothing anywhere", async () => {
    const target = new DocumentStore(idb.factory, "target");
    await target.add(doc("keep", 1));
    const before = JSON.stringify([...(idb.data.get("target")?.get("documents")?.keys() ?? [])]);
    await prepareRestore(await archive(), { store: target });
    expect(JSON.stringify([...(idb.data.get("target")?.get("documents")?.keys() ?? [])])).toBe(
      before,
    );
  });
});

describe("import: rejected archives (nothing is changed)", () => {
  const rejects = async (blob: Blob | Promise<Blob>, code: string) =>
    expect(await codeOf(prepareRestore(await blob, { store }))).toBe(code);

  it("damaged ZIP bytes", async () => {
    const z = new Uint8Array(await (await archive()).arrayBuffer());
    await rejects(new Blob([z.slice(0, z.length - 30)]), "corrupt");
    const dpos = new TextDecoder().decode(z).indexOf("documents/d1");
    const z3 = z.slice();
    z3[dpos + 40] = (z3[dpos + 40] as number) ^ 0x55; // inside the first document payload
    expect(["integrity", "corrupt"]).toContain(
      await codeOf(prepareRestore(new Blob([z3]), { store })),
    );
    await rejects(new Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3])]), "corrupt");
  });
  it("a document file missing from the archive", async () => {
    await rejects(archive(undefined, { omit: ["d2"] }), "missing-file");
  });
  it("an unexpected extra file", async () => {
    await rejects(archive(undefined, { extra: [["documents/ghost", enc("x")]] }), "extra-file");
  });
  it("not a backup: ZIP without manifest, wrong format name", async () => {
    await rejects(buildZip([{ name: "random.txt", data: enc("x") }]), "not-a-backup");
    await rejects(
      archive((m) => {
        (m as unknown as { format: string }).format = "other";
      }),
      "not-a-backup",
    );
  });
  it("newer and unsupported versions", async () => {
    await rejects(
      archive((m) => {
        m.version = 99;
      }),
      "newer-version",
    );
    await rejects(
      archive((m) => {
        m.version = 1;
      }),
      "unsupported",
    );
    await rejects(
      archive((m) => {
        (m as unknown as { version: string }).version = "2";
      }),
      "bad-manifest",
    );
  });
  it("wrong counts / sizes / totals in the manifest", async () => {
    await rejects(
      archive((m) => {
        m.counts.documents = 5;
      }),
      "integrity",
    );
    await rejects(
      archive((m) => {
        m.counts.totalBytes += 1;
      }),
      "integrity",
    );
    await rejects(
      archive((m) => {
        (m.documents[0] as { size: number }).size = 999;
      }),
      "integrity",
    );
    await rejects(
      archive((m) => {
        (m.documents[0] as { crc: number }).crc ^= 1;
      }),
      "integrity",
    );
    await rejects(
      archive((m) => {
        m.app.size += 1;
      }),
      "integrity",
    );
    await rejects(
      archive((m) => {
        m.app.crc ^= 1;
      }),
      "integrity",
    );
  });
  it("broken manifest structure", async () => {
    await rejects(
      buildZip([
        { name: "manifest.json", data: enc("{ not json") },
        { name: "data.json", data: enc("{}") },
      ]),
      "bad-manifest",
    );
    await rejects(
      archive((m) => {
        (m as unknown as { documents: unknown }).documents = "x";
      }),
      "bad-manifest",
    );
    await rejects(
      archive((m) => {
        (m as unknown as { app: unknown }).app = null;
      }),
      "bad-manifest",
    );
  });
  it("duplicate document ids", async () => {
    await rejects(
      archive((m) => {
        (m.documents[1] as { id: string }).id = "d1";
        (m.documents[1] as { file: string }).file = "documents/d1";
      }),
      "duplicate-id",
    );
  });
  it("unsafe ids / file names / path traversal in the manifest", async () => {
    await rejects(
      archive((m) => {
        (m.documents[0] as { id: string }).id = "../x";
      }),
      "bad-document",
    );
    await rejects(
      archive((m) => {
        (m.documents[0] as { file: string }).file = "documents/other";
      }),
      "bad-document",
    );
  });
  it("document larger than the 20 MiB limit", async () => {
    const huge = new Blob([new Uint8Array(20 * 1024 * 1024 + 1)], { type: "application/pdf" });
    await rejects(
      archive(undefined, { docs: [doc("huge", 1, { blob: huge, size: huge.size })] }),
      "too-large",
    );
  }, 30_000);
  it("exactly 20 MiB is still accepted", async () => {
    const edge = new Blob([new Uint8Array(20 * 1024 * 1024)], { type: "application/pdf" });
    const plan = await prepareRestore(
      await archive(undefined, { docs: [doc("edge", 1, { blob: edge, size: edge.size })] }),
      { store },
    );
    expect(plan.kind).toBe("zip");
  }, 30_000);
  it("MIME type outside the allowed list", async () => {
    await rejects(
      archive((m) => {
        (m.documents[0] as { mimeType: string }).mimeType = "text/html";
      }),
      "bad-document",
    );
    await rejects(
      archive((m) => {
        (m.documents[0] as { mimeType: string }).mimeType = "application/x-msdownload";
      }),
      "bad-document",
    );
  });
  it("invalid app data inside a valid container", async () => {
    await rejects(archive(undefined, { data: { shifts: "x", jobs: [] } }), "invalid-data");
  });
});

function makeDeps(
  target: DocumentStore,
  appData: AppData,
): RestoreDeps & { current: () => AppData; calls: AppData[] } {
  let current = appData;
  const calls: AppData[] = [];
  return {
    store: target,
    getData: () => current,
    replaceAll: (d) => {
      calls.push(d as AppData);
      current = d as AppData;
    },
    isPersistFailed: () => false,
    current: () => current,
    calls,
  };
}
async function planOf(
  blob: Blob,
  target: DocumentStore,
): Promise<Extract<RestorePlan, { kind: "zip" }>> {
  const p = await prepareRestore(blob, { store: target });
  if (p.kind !== "zip") throw new Error("expected zip");
  return p;
}

describe("restore: stage -> commit -> rollback", () => {
  it("restores documents byte-identical and replaces the app data; existing documents are kept", async () => {
    const target = new DocumentStore(idb.factory, "target");
    await target.add(doc("mine", 42, { name: "mine.pdf" }));
    const deps = makeDeps(target, OTHER);
    const r = await commitRestore(await planOf(await archive(), target), deps);
    expect(r).toEqual({ addedDocuments: 2, keptExistingDocuments: 0, addedFolders: 0 });
    expect((await target.ids()).sort()).toEqual(["d1", "d2", "mine"]);
    expect(await bytesOf((await target.get("d1")).blob)).toEqual(Array.from(fileBytes(3)));
    expect(await bytesOf((await target.get("mine")).blob)).toEqual(Array.from(fileBytes(42)));
    expect(deps.current()).toEqual(DATA);
  });
  it("a document id that already exists is NOT overwritten (existing bytes win) and is reported", async () => {
    const target = new DocumentStore(idb.factory, "target");
    await target.add(doc("d1", 99, { name: "existing-d1.pdf" }));
    const plan = await planOf(await archive(), target);
    expect(plan.summary).toMatchObject({ alreadyPresent: 1, toAdd: 1 });
    const r = await commitRestore(plan, makeDeps(target, OTHER));
    expect(r.keptExistingDocuments).toBe(1);
    expect((await target.get("d1")).name).toBe("existing-d1.pdf");
    expect(await bytesOf((await target.get("d1")).blob)).toEqual(Array.from(fileBytes(99)));
  });
  it("cancelled restore (plan never committed): nothing changed", async () => {
    const target = new DocumentStore(idb.factory, "target");
    await target.add(doc("mine", 1));
    const deps = makeDeps(target, OTHER);
    await planOf(await archive(), target); // user sees the preview and cancels
    expect(await target.ids()).toEqual(["mine"]);
    expect(deps.calls).toEqual([]);
    expect(deps.current()).toEqual(OTHER);
  });
  it("error in the middle of staging (quota): nothing written, app data and existing documents untouched", async () => {
    const target = new DocumentStore(idb.factory, "target");
    await target.add(doc("mine", 1));
    const plan = await planOf(await archive(), target);
    let n = 0;
    idb.faults.onWrite = () => (++n === 2 ? "QuotaExceededError" : undefined);
    const deps = makeDeps(target, OTHER);
    expect(await codeOf(commitRestore(plan, deps))).toBe("quota");
    idb.faults.onWrite = undefined;
    expect(await target.ids()).toEqual(["mine"]);
    expect(deps.calls).toEqual([]);
    expect(deps.current()).toEqual(OTHER);
  });
  it("interrupted staging transaction: nothing written", async () => {
    const target = new DocumentStore(idb.factory, "target");
    await target.add(doc("mine", 1));
    const plan = await planOf(await archive(), target);
    idb.faults.onWrite = () => "AbortError"; // the staging transaction is interrupted
    const deps = makeDeps(target, OTHER);
    expect(await codeOf(commitRestore(plan, deps))).toBe("commit-failed");
    idb.faults.onWrite = undefined;
    expect(await target.ids()).toEqual(["mine"]);
    expect(deps.calls).toEqual([]);
  });
  it("app-data commit fails after staging: the previous data is put back and the staged documents are removed again", async () => {
    const target = new DocumentStore(idb.factory, "target");
    await target.add(doc("mine", 1));
    const plan = await planOf(await archive(), target);
    let first = true;
    const base = makeDeps(target, OTHER);
    const deps: RestoreDeps = {
      ...base,
      replaceAll: (d) => {
        if (first) {
          first = false;
          throw new Error("boom");
        }
        base.replaceAll(d);
      },
    };
    const err = await commitRestore(plan, deps).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BackupError);
    expect((err as BackupError).code).toBe("commit-failed");
    expect((err as BackupError).rollbackIncomplete).toBe(false);
    expect(await target.ids()).toEqual(["mine"]); // staged d1/d2 rolled back, existing kept
    expect(base.current()).toEqual(OTHER);
  });
  it("persistence failure (localStorage full) after replaceAll triggers the same rollback", async () => {
    const target = new DocumentStore(idb.factory, "target");
    const plan = await planOf(await archive(), target);
    const base = makeDeps(target, OTHER);
    const deps: RestoreDeps = { ...base, isPersistFailed: () => true };
    expect(await codeOf(commitRestore(plan, deps))).toBe("commit-failed");
    expect(await target.ids()).toEqual([]);
    expect(base.current()).toEqual(OTHER);
    expect(base.calls.length).toBe(2); // restored data, then snapshot put back
  });
  it("rollback that cannot remove everything says so (rollbackIncomplete)", async () => {
    const target = new DocumentStore(idb.factory, "target");
    const plan = await planOf(await archive(), target);
    const base = makeDeps(target, OTHER);
    const deps: RestoreDeps = { ...base, isPersistFailed: () => true };
    let writes = 0;
    idb.faults.onWrite = () => (++writes > 2 ? "QuotaExceededError" : undefined); // staging (2 adds) ok, rollback delete fails
    const err = await commitRestore(plan, deps).catch((e: unknown) => e);
    expect((err as BackupError).code).toBe("commit-failed");
    expect((err as BackupError).rollbackIncomplete).toBe(true);
  });
  it("storage unavailable before staging: nothing changed", async () => {
    const plan = await planOf(await archive(), store);
    const down = new DocumentStore(createFakeIndexedDB().factory, "x");
    const d = createFakeIndexedDB();
    d.faults.openError = "SecurityError";
    void down;
    const deps = makeDeps(new DocumentStore(d.factory, "y"), OTHER);
    expect(await codeOf(commitRestore(plan, deps))).toBe("storage-unavailable");
    expect(deps.calls).toEqual([]);
  });
  it("round trip: export -> restore on an empty device -> export again gives an identical archive", async () => {
    await store.addMany(
      [doc("a", 1), doc("b", 2, { folderId: "f" })],
      [{ id: "f", name: "F", color: "#123" }],
    );
    const first = await exportBackup(DATA, { store, now: NOW });
    const target = new DocumentStore(idb.factory, "device2");
    const deps = makeDeps(target, OTHER);
    await commitRestore(await planOf(first.blob, target), deps);
    const second = await exportBackup(deps.current(), { store: target, now: NOW });
    expect(await bytesOf(second.blob)).toEqual(await bytesOf(first.blob));
  });
});
