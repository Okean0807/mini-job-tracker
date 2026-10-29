#!/usr/bin/env node
/**
 * Opt-in browser check of the QA fixes (absence range edit, historical weekly plan, sick-day list) on a
 * PHONE-SIZED screen (Pixel 5) with the REAL app in the GUEST scope (local data only). It starts a Vite dev
 * server and a dummy Supabase stub (no sign-in, nothing is sent anywhere), seeds localStorage and reads the
 * stored result back. Not part of `vitest run` and not CI; Playwright is intentionally not a dependency.
 *
 *   node scripts/absence-e2e-check.mjs
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require("playwright");
} catch {
  console.error(
    "Playwright is not installed (it is intentionally not a project dependency). Skipping.",
  );
  process.exit(2);
}
const { chromium, devices } = playwright;

const STUB_PORT = 5993;
const DEV_PORT = 5194;
const KEY = "minijob-tracker-v1:guest";
const stub = createServer((_req, res) => {
  res.statusCode = 404;
  res.end("{}");
}).listen(STUB_PORT, "127.0.0.1");
const env = {
  ...process.env,
  SUPABASE_URL: `http://127.0.0.1:${STUB_PORT}`,
  VITE_SUPABASE_URL: `http://127.0.0.1:${STUB_PORT}`,
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_TEST",
  VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_TEST",
  VITE_SUPABASE_PROJECT_ID: "test",
};

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  -> ${detail}`}`);
  if (!ok) failures += 1;
};

const day = (active) => ({ active, start: "08:00", end: "13:00", breakMinutes: 0 });
const MON_FRI = [1, 1, 1, 1, 1, 0, 0].map((a) => day(!!a));
const MON_ONLY = [1, 0, 0, 0, 0, 0, 0].map((a) => day(!!a));
const ALL_DAYS = [1, 1, 1, 1, 1, 1, 1].map((a) => day(!!a));
const baseSettings = {
  onboarded: true,
  wizardCompletedAt: 1,
  language: "de",
  autoBackup: false,
  bundesland: "BE",
};
const job = (week, extra = {}) => ({
  id: "J",
  name: "Fest",
  color: "#123456",
  rate: 15,
  mode: "fest",
  employmentType: "minijob",
  startDate: "2026-01-01",
  week,
  ...extra,
});
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => {
  const d = new Date(`${s}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
};
const urlaub = (id, date, note) => ({
  id,
  jobId: "J",
  kind: "urlaub",
  date,
  start: "08:00",
  end: "13:00",
  breakMinutes: 0,
  rate: 15,
  ...(note ? { note } : {}),
});
const krank = (date, caseId) => ({
  id: `k-${date}`,
  jobId: "J",
  kind: "krank",
  date,
  start: "08:00",
  end: "13:00",
  breakMinutes: 0,
  rate: 15,
  sickCaseId: caseId,
});

async function newPage(browser, data, path = "/") {
  const context = await browser.newContext({ ...devices["Pixel 5"] });
  await context.clock.setFixedTime(new Date("2026-10-29T10:00:00"));
  await context.addInitScript(
    ({ KEY, data }) => {
      if (localStorage.getItem(KEY)) return; // seed once, never on reload
      localStorage.setItem("minijob-active-scope-v1", "guest");
      localStorage.setItem(KEY, JSON.stringify(data));
    },
    { KEY, data },
  );
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${DEV_PORT}${path}`, { waitUntil: "networkidle" });
  return { context, page };
}
const stored = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY);
async function toSeptember(page) {
  await page.getByRole("button", { name: "Vorheriger Monat" }).click(); // 29.10.2026 -> September 2026 is one click back
  await page.getByRole("heading", { name: /September 2026/ }).waitFor();
}
// September 2026 starts on a Tuesday -> one leading placeholder cell in a Monday-first grid
const cell = (page, d) => page.locator(".mt-1.grid.grid-cols-7 > *").nth(1 + d - 1);

const dev = spawn(
  "npx",
  ["vite", "dev", "--port", String(DEV_PORT), "--host", "127.0.0.1", "--strictPort"],
  { env, stdio: "ignore", detached: true },
);
try {
  for (let i = 0; i < 90; i += 1) {
    try {
      if ((await fetch(`http://127.0.0.1:${DEV_PORT}/`)).ok) break;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  const browser = await chromium.launch();

  try {
    // ---- P0 A+B: week 07.-11.09. (plan then Mo-Fr), plan changed to Mon only on 20.10.; note on Wednesday
    {
      const w1 = [7, 8, 9, 10, 11].map((d) =>
        urlaub(
          `u${d}`,
          `2026-09-${String(d).padStart(2, "0")}`,
          d === 9 ? "Notiz bleibt" : undefined,
        ),
      );
      const data = {
        shifts: w1,
        jobs: [job(MON_ONLY, { weekHistory: [{ effectiveFrom: "2026-10-20", week: MON_FRI }] })],
        settings: baseSettings,
      };
      const { context, page } = await newPage(browser, data);
      await toSeptember(page);
      const before = await stored(page);

      // open the range (tap a day that only has absence entries) and save without any change
      await cell(page, 8).click();
      const dlg = page.getByRole("dialog");
      await dlg.waitFor();
      await dlg.getByRole("button", { name: "Speichern" }).click();
      await dlg.waitFor({ state: "hidden" });
      let now = await stored(page);
      check(
        "re-save without change: still five entries",
        now.shifts.length === 5,
        `${now.shifts.length} entries: ${now.shifts.map((s) => s.date).join(",")}`,
      );
      check(
        "re-save without change: same entry IDs",
        JSON.stringify(now.shifts.map((s) => s.id).sort()) ===
          JSON.stringify(before.shifts.map((s) => s.id).sort()),
      );
      check(
        "re-save without change: Wednesday note kept",
        now.shifts.find((s) => s.date === "2026-09-09")?.note === "Notiz bleibt",
      );

      // extend the end to Sunday: with the OLD code Tue-Fri were deleted because today's plan is Monday only
      await cell(page, 8).click();
      await dlg.waitFor();
      await dlg.locator("#absence-to").fill("2026-09-13");
      await dlg.getByRole("button", { name: "Speichern" }).click();
      await dlg.waitFor({ state: "hidden" });
      now = await stored(page);
      const kept = ["u7", "u8", "u9", "u10", "u11"].every((id) =>
        now.shifts.some((s) => s.id === id),
      );
      check(
        "extend to Sunday after plan change: all five entries (and IDs) survive",
        kept && now.shifts.length === 5,
        `${now.shifts.length} entries`,
      );
      check(
        "extend to Sunday: note kept, no duplicate days",
        now.shifts.find((s) => s.id === "u9")?.note === "Notiz bleibt" &&
          new Set(now.shifts.map((s) => s.date)).size === now.shifts.length,
      );

      await page.reload({ waitUntil: "networkidle" });
      now = await stored(page);
      check(
        "after reload the data is unchanged",
        now.shifts.length === 5 && now.shifts.find((s) => s.id === "u9")?.note === "Notiz bleibt",
      );

      await context.close();
    }
  } catch (error) {
    check("P0 flow completed", false, String(error).split("\n")[0]);
  }

  try {
    // ---- P0 B: new absence for a past week AFTER the plan change; the payroll plan then was Mo-Fr
    const data = {
      shifts: [],
      jobs: [job(MON_ONLY, { weekHistory: [{ effectiveFrom: "2026-10-20", week: MON_FRI }] })],
      settings: baseSettings,
    };
    const { context, page } = await newPage(browser, data);
    await toSeptember(page);
    await cell(page, 14).click(); // empty day -> entry editor
    await page.locator('[data-testid="shift-dialog"] button[data-kind="urlaub"]').click();
    await page.getByTestId("entry-absence-range").click();
    const dlg2 = page.getByRole("dialog");
    await dlg2.locator("#absence-from").fill("2026-09-14");
    await dlg2.locator("#absence-to").fill("2026-09-20");
    await dlg2.getByRole("button", { name: "Speichern" }).click();
    await dlg2.waitFor({ state: "hidden" });
    const now = await stored(page);
    const created = now.shifts
      .filter((s) => s.date >= "2026-09-14" && s.date <= "2026-09-20")
      .map((s) => s.date)
      .sort();
    check(
      "past week after plan change: Mon-Fri created (5 days), not just Monday",
      JSON.stringify(created) ===
        JSON.stringify(["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18"]),
      created.join(","),
    );
    await context.close();
  } catch (error) {
    check("P0 B flow completed", false, String(error).split("\n")[0]);
  }

  try {
    // ---- P1b: Statistik XLSX export of September for a sick case that began in August (full history needed)
    const sick = [];
    for (let d = "2026-08-10"; d <= "2026-10-09"; d = addDays(d, 1)) sick.push(krank(d, "case1"));
    const data = {
      shifts: sick,
      jobs: [job(ALL_DAYS)],
      settings: { ...baseSettings, premium: true }, // XLSX export is a premium feature in this build
    };
    const { context, page } = await newPage(browser, data, "/statistik");
    await page.getByRole("button", { name: "Vorherige Periode" }).click(); // October -> September
    await page
      .getByText(/September 2026/)
      .first()
      .waitFor();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Einträge Excel" }).click(),
    ]);
    const XLSX = require("xlsx");
    const book = XLSX.readFile(await download.path());
    const rows = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { header: 1 });
    const body = rows.slice(1);
    const totalRow = body[body.length - 1];
    const row21 = body.find((r) => String(r[0]).startsWith("21.09.2026"));
    const row20 = body.find((r) => String(r[0]).startsWith("20.09.2026"));
    check(
      "XLSX export of September: one row per September entry plus the total row",
      body.length === 31,
      `${body.length} rows`,
    );
    check(
      "XLSX export: day 43 earns 0 (same as the screen)",
      row21 && Number(row21[9]) === 0,
      JSON.stringify(row21),
    );
    check("XLSX export: day 42 earns 75", row20 && Number(row20[9]) === 75, JSON.stringify(row20));
    check(
      "XLSX export: total = 20 paid days x 75 = 1500 (same as the month total)",
      Number(totalRow[9]) === 1500,
      JSON.stringify(totalRow),
    );
    await context.close();
  } catch (error) {
    check("P1b export flow completed", false, String(error).split("\n")[0]);
  }

  try {
    // ---- P1: sick case 10.08.-09.10. (all days are plan days). Day 42 = 20.09. paid, day 43 = 21.09. not paid
    {
      const sick = [];
      for (let d = "2026-08-10"; d <= "2026-10-09"; d = addDays(d, 1)) sick.push(krank(d, "case1"));
      const data = { shifts: sick, jobs: [job(ALL_DAYS)], settings: baseSettings };
      const { context, page } = await newPage(browser, data);
      await toSeptember(page);
      const list = page.locator("ul >> li", { hasText: "21.09.2026" }).first();
      await list.waitFor();
      const text = (await list.textContent()).replace(/\u00a0/g, " ");
      check(
        "day 43 is listed as unpaid (not '§ 3 EntgFG' with an amount)",
        text.includes("Ohne Entgeltfortzahlung") &&
          !text.includes("(§ 3 EntgFG)") &&
          text.includes("0,00 €"),
        text,
      );
      const paid = (
        await page.locator("ul >> li", { hasText: "18.09.2026" }).first().textContent()
      ).replace(/\u00a0/g, " ");
      check(
        "day 40 is listed as paid sick pay",
        paid.includes("(§ 3 EntgFG)") && paid.includes("75,00 €"),
        paid,
      );
      const c21 = (await cell(page, 21).textContent()).replace(/\u00a0/g, " ");
      await list.click(); // open the entry editor for day 43
      const preview = page.getByTestId("entry-absence-preview");
      await preview.waitFor();
      const previewText = ((await preview.textContent()) ?? "").replace(/\u00a0/g, " ");
      check(
        "editor preview of day 43: 0 h and 0,00 € (same as list and month total)",
        (await preview.getAttribute("data-hours")) === "0" && previewText.includes("0,00 €"),
        previewText,
      );
      await page.getByTestId("entry-save").click(); // saving must keep the case: day 43 stays unpaid
      await page.waitForTimeout(300);
      const savedAfter = await stored(page);
      const day43 = savedAfter.shifts.find((x) => x.date === "2026-09-21");
      check(
        "saving the sick day in the editor keeps its case id",
        day43?.sickCaseId === "case1",
        JSON.stringify(day43),
      );
      await page.reload({ waitUntil: "networkidle" });
      await toSeptember(page);
      const afterSave = (
        (await page.locator("ul >> li", { hasText: "21.09.2026" }).first().textContent()) ?? ""
      ).replace(/\u00a0/g, " ");
      check(
        "after save and reload day 43 is still listed as unpaid",
        afterSave.includes("Ohne Entgeltfortzahlung"),
        afterSave,
      );
      check(
        "calendar day 43: no hours and no 'Geplant' label",
        !/\bh\b/.test(c21) && !c21.includes("Geplant"),
        c21,
      );
      check(
        "calendar day 42 shows its 5 hours",
        /5,0 h/.test((await cell(page, 20).textContent()).replace(/\u00a0/g, " ")),
      );
      await context.close();
    }
  } catch (error) {
    check("P1 flow completed", false, String(error).split("\n")[0]);
  }

  await browser.close();
} finally {
  try {
    process.kill(-dev.pid);
  } catch {
    /* already gone */
  }
  stub.close();
}
console.log(
  failures
    ? `${failures} CHECK(S) FAILED`
    : "ALL E2E CHECKS PASSED (guest scope, local data only, dummy Supabase stub)",
);
process.exit(failures ? 1 : 0);
