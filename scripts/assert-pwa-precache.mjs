#!/usr/bin/env node
/**
 * Build regression: ensure generateSW wrote a non-empty precache into Nitro's
 * Vercel static output (where /sw.js is served in production).
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const swPath = resolve(".vercel/output/static/sw.js");
if (!existsSync(swPath)) {
  console.error(`assert-pwa-precache: missing ${swPath}`);
  process.exit(1);
}

const sw = readFileSync(swPath, "utf8");
// workbox generateSW inlines precacheAndRoute([{url,revision}|{url,revision:null},...])
const match = sw.match(/precacheAndRoute\(\s*(\[[\s\S]*?\])\s*,/);
if (!match) {
  console.error("assert-pwa-precache: no precacheAndRoute manifest found in sw.js");
  process.exit(1);
}

let entries;
try {
  // Manifest is JSON-like (URL strings / null revisions); eval-safe enough via Function
  entries = Function(`"use strict"; return (${match[1]});`)();
} catch (err) {
  console.error("assert-pwa-precache: failed to parse precache manifest:", err.message);
  process.exit(1);
}

if (!Array.isArray(entries) || entries.length === 0) {
  console.error(`assert-pwa-precache: expected >0 precache entries, got ${entries?.length ?? entries}`);
  process.exit(1);
}

const urls = entries.map((e) => (typeof e === "string" ? e : e.url));
const unique = new Set(urls);
if (unique.size !== urls.length) {
  console.error(`assert-pwa-precache: duplicate precache URLs (${urls.length} entries, ${unique.size} unique)`);
  process.exit(1);
}
const hasHashedAsset = urls.some((u) => typeof u === "string" && u.includes("assets/"));
if (!hasHashedAsset) {
  console.error("assert-pwa-precache: precache has entries but none under assets/", urls.slice(0, 10));
  process.exit(1);
}

console.log(`assert-pwa-precache: OK — ${entries.length} precache entries (sample: ${urls.slice(0, 5).join(", ")})`);
