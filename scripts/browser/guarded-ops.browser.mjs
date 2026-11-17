/**
 * Real-app browser check (Chromium, 360×800) of the Phase 4 guarded import / recovery flow.
 *
 * Needs a running dev server with DUMMY Supabase env (no real backend is contacted: every
 * request to a non-local host is aborted and reported):
 *   VITE_SUPABASE_URL=https://example.invalid VITE_SUPABASE_PUBLISHABLE_KEY=dummy \
 *   VITE_SUPABASE_PROJECT_ID=dummy npx vite dev --port 5199 --host 127.0.0.1
 *   NODE_PATH=$(npm root -g) BASE_URL=http://127.0.0.1:5199 node scripts/browser/guarded-ops.browser.mjs
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:5199";

let failed = 0;
const pass = (name, detail = "") => console.log(`PASS ${name}${detail ? ` — ${detail}` : ""}`);
const fail = (name, detail = "") => {
  failed += 1;
  console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
};
const check = (name, ok, detail) => (ok ? pass(name, detail) : fail(name, detail));

const localPayload = {
  shifts: [
    { id: "local-s1", kind: "arbeit", date: "2026-01-05", start: "09:00", end: "10:00", breakMinutes: 0, jobId: "j1" },
    { id: "local-s2", kind: "arbeit", date: "2026-01-06", start: "09:00", end: "10:00", breakMinutes: 0, jobId: "j1" },
  ],
  jobs: [{ id: "j1", name: "Lokal", color: "#111111", mode: "flex" }],
  customers: [], projects: [], payments: [], goals: [], orders: [], objects: [],
  settings: { onboarded: true, wizardCompletedAt: 1, language: "de", autoBackup: false },
  timer: null,
};
const filePayload = {
  shifts: [{ id: "file-s1", kind: "arbeit", date: "2026-09-16", start: "08:00", end: "12:00", breakMinutes: 0, jobId: "fj" }],
  jobs: [{ id: "fj", name: "Datei", color: "#222222", mode: "flex" }],
  settings: { onboarded: true, wizardCompletedAt: 1, language: "de", pin: "7777", pinEnabled: true },
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 360, height: 800 }, deviceScaleFactor: 1 });
const external = [];
const pageErrors = [];
await context.route("**/*", (route) => {
  const url = route.request().url();
  if (url.startsWith(BASE) || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
  external.push(url);
  return route.abort();
});
await context.addInitScript((payload) => {
  if (!localStorage.getItem("minijob-tracker-v1:guest")) {
    localStorage.setItem("minijob-tracker-v1:guest", JSON.stringify(payload));
  }
}, localPayload);
const page = await context.newPage();
page.on("pageerror", (e) => pageErrors.push(String(e.message).slice(0, 200)));

const guestShiftIds = () =>
  page.evaluate(() => JSON.parse(localStorage.getItem("minijob-tracker-v1:guest") ?? "{}").shifts?.map((s) => s.id) ?? []);
const guestSettings = () =>
  page.evaluate(() => JSON.parse(localStorage.getItem("minijob-tracker-v1:guest") ?? "{}").settings ?? {});
const snapshots = () =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        const r = indexedDB.open("minijob-safety-v1", 1);
        r.onupgradeneeded = () => {
          r.result.createObjectStore("snapshots", { keyPath: "id" });
        };
        r.onsuccess = () => {
          const db = r.result;
          if (!db.objectStoreNames.contains("snapshots")) return resolve([]);
          const q = db.transaction("snapshots").objectStore("snapshots").getAll();
          q.onsuccess = () => {
            db.close();
            resolve(q.result.map((x) => ({ kind: x.kind, state: x.state, scope: x.scope, shifts: x.counts.shifts, hasPin: x.payload.includes("7777") })));
          };
        };
        r.onerror = () => resolve([]);
      }),
  );

async function overflowOk() {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}

await page.goto(`${BASE}/einstellungen`, { waitUntil: "domcontentloaded" });
const input = page.locator('input[type="file"][accept="application/json"]').first();
await input.waitFor({ state: "attached", timeout: 60000 });
check("Settings page renders at 360×800 without horizontal overflow", await overflowOk());
check("Recovery points section with privacy notice is visible", await page.getByTestId("recovery-privacy").isVisible().catch(() => false));
check("Recovery section starts empty", (await snapshots()).length === 0);

const importFile = () =>
  input.setInputFiles({ name: "backup.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(filePayload)) });

// 1) Cancel: nothing changes.
await importFile();
const dialog = page.getByTestId("guarded-dialog");
await dialog.waitFor({ state: "visible", timeout: 15000 });
const box = await dialog.boundingBox();
check("confirmation dialog fits the 360×800 viewport", !!box && box.x >= 0 && box.x + box.width <= 360 && box.y >= 0 && box.y + box.height <= 800, JSON.stringify(box && { x: Math.round(box.x), w: Math.round(box.width), h: Math.round(box.height) }));
check("no horizontal overflow while the dialog is open", await overflowOk());
const text = (await dialog.innerText()).replace(/\s+/g, " ");
check("dialog names the operation and what is replaced", /Datei importieren/.test(text) && /lokalen Daten/.test(text));
check("dialog shows the comparison (lost / added)", /Schichten: Gehen verloren 2 · Kommen hinzu 1/.test(text), text.slice(0, 260));
check("dialog mentions the recovery copy and device PIN", /Wiederherstellungskopie/.test(text) && /PIN/.test(text));
const confirmBtn = dialog.getByRole("button", { name: "Ja, ersetzen" });
const cancelBtn = dialog.getByRole("button", { name: "Abbrechen" });
const cb = await confirmBtn.boundingBox();
const xb = await cancelBtn.boundingBox();
check("confirm and cancel buttons are fully visible in the viewport", !!cb && !!xb && cb.y + cb.height <= 800 && xb.y + xb.height <= 800 && cb.x >= 0 && cb.x + cb.width <= 360 && xb.x >= 0 && xb.x + xb.width <= 360);
await page.waitForTimeout(600); // Einblend-Animation abwarten
await page.screenshot({ path: process.env.SHOT_DIR ? `${process.env.SHOT_DIR}/guarded-dialog-360.png` : "/tmp/claude-0/guarded-dialog-360.png" });
await cancelBtn.click();
await dialog.waitFor({ state: "hidden", timeout: 5000 });
check("cancel: data unchanged", JSON.stringify(await guestShiftIds()) === JSON.stringify(["local-s1", "local-s2"]));
check("cancel: no snapshot created", (await snapshots()).length === 0);

// 2) Confirm: snapshot first, then replace; device PIN stays untouched (no PIN configured locally).
await importFile();
await dialog.waitFor({ state: "visible", timeout: 15000 });
await dialog.getByRole("button", { name: "Ja, ersetzen" }).click();
await dialog.waitFor({ state: "hidden", timeout: 15000 });
await page.waitForFunction(() => JSON.parse(localStorage.getItem("minijob-tracker-v1:guest") ?? "{}").shifts?.[0]?.id === "file-s1", null, { timeout: 15000 });
check("confirm: data replaced by the file", JSON.stringify(await guestShiftIds()) === JSON.stringify(["file-s1"]));
check("confirm: the PIN from the file was NOT adopted", (await guestSettings()).pin === undefined || (await guestSettings()).pin !== "7777");
const afterImport = await snapshots();
check("confirm: one verified local_pre_import snapshot of the previous data", afterImport.length === 1 && afterImport[0].kind === "local_pre_import" && afterImport[0].state === "verified" && afterImport[0].shifts === 2 && afterImport[0].scope === "guest" && !afterImport[0].hasPin, JSON.stringify(afterImport));
await page.getByTestId("recovery-points").getByText("Vor Datei-Import").first().waitFor({ state: "visible", timeout: 10000 });
check("recovery list shows the new recovery point", true);

// 3) Restore from the snapshot (guarded): comparison shown, current state snapshotted first.
await page.getByTestId("recovery-restore").first().click();
await dialog.waitFor({ state: "visible", timeout: 15000 });
const text2 = (await dialog.innerText()).replace(/\s+/g, " ");
check("restore: dialog titled for recovery point restore", /Wiederherstellungspunkt zurückspielen/.test(text2));
check("restore dialog fits the viewport", await dialog.boundingBox().then((b) => !!b && b.x >= 0 && b.x + b.width <= 360 && b.y + b.height <= 800));
await dialog.getByRole("button", { name: "Ja, ersetzen" }).click();
await dialog.waitFor({ state: "hidden", timeout: 15000 });
await page.waitForFunction(() => JSON.parse(localStorage.getItem("minijob-tracker-v1:guest") ?? "{}").shifts?.length === 2, null, { timeout: 15000 });
check("restore: previous data is back", JSON.stringify(await guestShiftIds()) === JSON.stringify(["local-s1", "local-s2"]));
const afterRestore = await snapshots();
check("restore: current state was snapshotted first (local_pre_restore added)", afterRestore.some((s) => s.kind === "local_pre_restore" && s.shifts === 1) && afterRestore.some((s) => s.kind === "local_pre_import"), JSON.stringify(afterRestore.map((s) => s.kind)));
check("no horizontal overflow at the end", await overflowOk());

// 4) Two real tabs of the same browser: a write by tab 2 reaches tab 1 through the real `storage` event
//    (Phase 5: tabs used to diverge silently, which let an automatic pull overwrite the other tab's edits).
const page2 = await context.newPage();
await page2.goto(`${BASE}/einstellungen`, { waitUntil: "domcontentloaded" });
await page2.locator('input[type="file"][accept="application/json"]').first().waitFor({ state: "attached", timeout: 60000 });
await page2.evaluate(() => {
  const k = "minijob-tracker-v1:guest";
  const d = JSON.parse(localStorage.getItem(k));
  d.shifts.push({ id: "tab2-shift", kind: "arbeit", date: "2026-02-02", start: "10:00", end: "11:00", breakMinutes: 0, jobId: "j1" });
  localStorage.setItem(k, JSON.stringify(d));
});
await page.waitForTimeout(800);
const [download] = await Promise.all([
  page.waitForEvent("download", { timeout: 15000 }),
  page.getByRole("button", { name: "Exportieren" }).first().click(),
]);
const exported = JSON.parse(await (await import("node:fs/promises")).readFile(await download.path(), "utf8"));
check("two tabs: tab 1 adopted tab 2's write via the real storage event", exported.shifts.some((x) => x.id === "tab2-shift"), exported.shifts.map((x) => x.id).join(","));
await page2.close();

check("no request left the local origin (0 external)", external.length === 0, external.slice(0, 3).join(","));
check("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));

await browser.close();
console.log(failed ? `\n${failed} check(s) FAILED` : "\nall browser checks passed");
process.exit(failed ? 1 : 0);
