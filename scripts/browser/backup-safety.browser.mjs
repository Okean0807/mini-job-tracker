/**
 * Real-browser (Chromium + IndexedDB) tests for the Phase 3 snapshot store.
 *
 * Run:  NODE_PATH=$(npm root -g) node scripts/browser/backup-safety.browser.mjs
 * (Playwright is not a project dependency; it is resolved from the global install.)
 * Bundles src/lib/minijob/backup-safety.ts with rolldown (already part of Vite 8), serves it
 * from a fake origin via request interception, and fails on ANY request to another host.
 */
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const { build } = await import("rolldown");

const out = mkdtempSync(join(tmpdir(), "mjc-safety-"));
await build({
  input: resolve("scripts/browser/backup-safety.entry.ts"),
  output: { file: join(out, "bundle.js"), format: "iife", name: "Safety" },
  platform: "browser",
  logLevel: "silent",
});
const bundle = readFileSync(join(out, "bundle.js"), "utf8");

const ORIGIN = "https://minijob.test";
const results = [];
const external = [];
let failed = 0;

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();
await page.route("**/*", (route) => {
  const url = route.request().url();
  if (url === `${ORIGIN}/`) return route.fulfill({ contentType: "text/html", body: "<!doctype html><title>t</title>" });
  if (url === `${ORIGIN}/bundle.js`) return route.fulfill({ contentType: "text/javascript", body: bundle });
  if (!url.startsWith(ORIGIN)) external.push(url);
  return route.abort();
});
await page.goto(`${ORIGIN}/`);

const data = (n = 1, over = {}) => ({
  shifts: Array.from({ length: n }, (_, i) => ({ id: `s${i}`, date: `2026-01-0${(i % 9) + 1}` })),
  jobs: [{ id: "j1" }],
  customers: [],
  projects: [],
  payments: [],
  goals: [],
  orders: [],
  objects: [],
  settings: { onboarded: true, pin: "1234", pinEnabled: true, biometric: true, biometricCredentialId: "cred" },
  timer: null,
  ...over,
});

async function scenario(name, fn, arg) {
  try {
    await page.evaluate(async () => {
      await new Promise((res) => {
        const r = indexedDB.deleteDatabase("minijob-safety-v1");
        r.onsuccess = r.onerror = r.onblocked = () => res();
      });
    });
    const detail = await page.evaluate(fn, arg ?? null);
    results.push({ name, ok: true, detail });
    console.log(`PASS ${name}${detail ? ` — ${detail}` : ""}`);
  } catch (error) {
    failed += 1;
    results.push({ name, ok: false });
    console.log(`FAIL ${name}: ${String(error.message).split("\n")[0]}`);
  }
}

// Helpers injected into the page (again after every navigation).
async function inject() {
  await page.addScriptTag({ url: `${ORIGIN}/bundle.js` });
  await page.evaluate(`
  window.mk = (${data.toString()});
  window.fresh = () => Safety.createIndexedDbStorage();
  window.A = Safety.userScope("user-a"); window.B = Safety.userScope("user-b"); window.AB = Safety.userScope("user-a-b");
  window.raw = () => new Promise((res, rej) => { const r = indexedDB.open("minijob-safety-v1", 1); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  window.rawAll = async () => { const db = await raw(); return new Promise((res) => { const q = db.transaction("snapshots").objectStore("snapshots").getAll(); q.onsuccess = () => { db.close(); res(q.result); }; }); };
  window.sha = async (t) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)))].map((b) => b.toString(16).padStart(2, "0")).join("");
  window.expectErr = async (p, code) => { try { await p; } catch (e) { if (e.code === code) return true; throw new Error("wrong error " + e.code); } throw new Error("no error"); };
`);
}
await inject();

await scenario("schema: DB, store, indexes", async () => {
  const s = fresh();
  await Safety.createSnapshot({ kind: "local_pre_restore", scope: A, data: mk() }, { backend: s });
  const db = await raw();
  const tx = db.transaction("snapshots");
  const store = tx.objectStore("snapshots");
  const info = { name: db.name, version: db.version, key: store.keyPath, idx: [...store.indexNames].sort() };
  db.close();
  if (info.name !== "minijob-safety-v1" || info.version !== 1 || info.key !== "id") throw new Error(JSON.stringify(info));
  if (info.idx.join() !== "byScope,byScopeKind") throw new Error(JSON.stringify(info));
  return JSON.stringify(info);
});

await scenario("create: pending→verified, SHA-256 equals crypto.subtle, no device credentials", async () => {
  const s = fresh();
  const { summary } = await Safety.createSnapshot({ kind: "local_pre_import", scope: A, data: mk(3) }, { backend: s });
  const [rec] = await rawAll();
  if (rec.state !== "verified") throw new Error("state " + rec.state);
  if ((await sha(rec.payload)) !== rec.sha256 || summary.sha256 !== rec.sha256) throw new Error("sha mismatch");
  if (rec.payload.includes("1234") || rec.payload.includes("cred")) throw new Error("credentials stored");
  if (rec.counts.shifts !== 3 || rec.totalRecords !== 4) throw new Error("counts");
  return `sha256=${rec.sha256.slice(0, 12)}…`;
});

await scenario("ring: two newest verified per kind, kinds separate", async () => {
  const s = fresh();
  for (const kind of ["local_pre_restore", "cloud_pre_overwrite", "local_pre_import"])
    for (let i = 0; i < 4; i++) await Safety.createSnapshot({ kind, scope: A, data: mk(i + 1) }, { backend: s });
  const all = await rawAll();
  if (all.length !== 6) throw new Error("count " + all.length);
  for (const kind of ["local_pre_restore", "cloud_pre_overwrite", "local_pre_import"]) {
    const k = all.filter((r) => r.kind === kind);
    if (k.length !== 2 || k.some((r) => r.state !== "verified")) throw new Error("kind " + kind);
    if (k.some((r) => r.counts.shifts < 3)) throw new Error("kept wrong ones");
  }
  return "6 records (2 per kind)";
});

await scenario("scope isolation incl. prefix trap; delete-all and purge hit only the exact scope", async () => {
  const s = fresh();
  const deps = { backend: s };
  for (const sc of [A, B, AB, Safety.GUEST_SCOPE, Safety.DEMO_SCOPE])
    await Safety.createSnapshot({ kind: "local_pre_restore", scope: sc, data: mk() }, deps);
  for (const sc of [A, B, AB, Safety.GUEST_SCOPE, Safety.DEMO_SCOPE]) {
    if ((await Safety.listSnapshots(sc, deps)).length !== 1) throw new Error("list leak");
  }
  const [other] = await Safety.listSnapshots(B, deps);
  await expectErr(Safety.getSnapshotFile(other.id, A, deps), "not-found");
  await expectErr(Safety.deleteSnapshot(other.id, A, deps), "not-found");
  const markers = { v: [], read() { return [...this.v]; }, write(x) { this.v = x; } };
  await Safety.purgeScopeSnapshots(A, deps, markers);
  if ((await Safety.listSnapshots(A, deps)).length !== 0) throw new Error("A not purged");
  for (const sc of [B, AB, Safety.GUEST_SCOPE, Safety.DEMO_SCOPE])
    if ((await Safety.listSnapshots(sc, deps)).length !== 1) throw new Error("collateral delete");
  if (markers.v.length) throw new Error("marker left");
  if ((await Safety.deleteAllSnapshots(B, deps)) !== 1) throw new Error("deleteAll count");
  if ((await rawAll()).length !== 3) throw new Error("others lost");
  return "A purged; B/AB/guest/demo untouched until own delete";
});

await scenario("persists across reload (write)", async () => {
  const s = fresh();
  await Safety.createSnapshot({ kind: "local_pre_restore", scope: A, data: mk(2) }, { backend: s });
  return "written";
});
await page.reload();
await inject();
await (async () => {
  const n = await page.evaluate(async () =>
    (await Safety.listSnapshots(A, { backend: fresh() })).length);
  if (n === 1) { results.push({ name: "reload keeps snapshot", ok: true }); console.log("PASS reload keeps snapshot — 1 verified after reload"); }
  else { failed += 1; console.log("FAIL reload keeps snapshot"); }
})();

await scenario("quota error (real DOMException from IndexedDB put) → code quota, nothing stored", async () => {
  const s = fresh();
  const orig = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function () { throw new DOMException("quota", "QuotaExceededError"); };
  try {
    await expectErr(Safety.createSnapshot({ kind: "local_pre_restore", scope: A, data: mk() }, { backend: s }), "quota");
  } finally { IDBObjectStore.prototype.put = orig; }
  if ((await rawAll()).length !== 0) throw new Error("leftover");
  return "quota";
});

await scenario("transaction abort (real tx.abort) → code aborted, nothing stored", async () => {
  const s = fresh();
  const orig = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (v) { this.transaction.abort(); return orig.call(this, v); };
  try {
    await expectErr(Safety.createSnapshot({ kind: "local_pre_restore", scope: A, data: mk() }, { backend: s }), "aborted");
  } finally { IDBObjectStore.prototype.put = orig; }
  if ((await rawAll()).length !== 0) throw new Error("leftover");
  return "aborted";
});

await scenario("IndexedDB unavailable (no factory / open throws) → code unavailable", async () => {
  await expectErr(Safety.createSnapshot({ kind: "local_pre_restore", scope: A, data: mk() }, { backend: Safety.createIndexedDbStorage(null) }), "unavailable");
  const broken = { open() { throw new DOMException("denied", "SecurityError"); } };
  await expectErr(Safety.createSnapshot({ kind: "local_pre_restore", scope: A, data: mk() }, { backend: Safety.createIndexedDbStorage(broken) }), "unavailable");
  return "unavailable x2";
});

await scenario("tampered payload in real IndexedDB → SHA-256 mismatch on download; pending never listed", async () => {
  const s = fresh();
  const deps = { backend: s };
  const { summary } = await Safety.createSnapshot({ kind: "local_pre_restore", scope: A, data: mk() }, deps);
  const db = await raw();
  await new Promise((res) => {
    const st = db.transaction("snapshots", "readwrite").objectStore("snapshots");
    const g = st.get(summary.id);
    g.onsuccess = () => { const r = g.result; r.payload = r.payload.replace("s0", "sX"); st.put(r); };
    st.transaction.oncomplete = () => { db.close(); res(); };
  });
  try { await Safety.getSnapshotFile(summary.id, A, deps); throw new Error("not detected"); }
  catch (e) { if (e.code !== "verification-failed" || e.reason !== "sha256-mismatch") throw e; }
  return "sha256-mismatch detected";
});

await scenario("interrupted pending snapshot is removed at initialization; verified one survives", async () => {
  const s = fresh();
  const deps = { backend: s };
  const { summary } = await Safety.createSnapshot({ kind: "local_pre_restore", scope: A, data: mk() }, deps);
  const [ok] = await rawAll();
  await s.put({ ...ok, id: "stuck", state: "pending", createdAt: Date.now() - 60 * 60 * 1000 });
  if ((await Safety.listSnapshots(A, deps)).length !== 1) throw new Error("pending listed");
  const n = await Safety.recoverPendingSnapshots(deps);
  const ids = (await rawAll()).map((r) => r.id);
  if (n !== 1 || ids.join() !== summary.id) throw new Error("recovery " + n + " " + ids);
  return "1 stale pending removed";
});

await scenario("failed verification never deletes a verified snapshot (real DB)", async () => {
  const s = fresh();
  const deps = { backend: s };
  await Safety.createSnapshot({ kind: "local_pre_restore", scope: A, data: mk() }, deps);
  const flaky = { ...s, get: async () => ({ id: "x" }) };
  try { await Safety.createSnapshot({ kind: "local_pre_restore", scope: A, data: mk(2) }, { backend: flaky }); throw new Error("no error"); }
  catch (e) { if (e.code !== "verification-failed") throw e; }
  const all = await rawAll();
  if (all.length !== 1 || all[0].state !== "verified") throw new Error("verified lost or pending left");
  return "1 verified kept";
});

if (external.length) { failed += 1; console.log("FAIL external requests: " + external.length); }
else console.log("PASS no requests outside the test origin (0 external)");

await browser.close();
console.log(`\n${results.length - failed}/${results.length} scenarios passed`);
process.exit(failed ? 1 : 0);
