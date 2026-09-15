/**
 * SyncStatusRow must arm a UI failsafe so "Wird synchronisiert …" cannot stick
 * past SYNC_TIMEOUT_MS even if cloud Promise.race fails in production.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const srcPath = join(dirname(fileURLToPath(import.meta.url)), "einstellungen.tsx");
const src = readFileSync(srcPath, "utf8");

describe("einstellungen SyncStatusRow hard watchdog failsafe", () => {
  it("imports SYNC_TIMEOUT_MS and forceFailStuckSync", () => {
    expect(src).toMatch(/forceFailStuckSync/);
    expect(src).toMatch(/SYNC_TIMEOUT_MS/);
  });

  it("SyncStatusRow arms timeout SYNC_TIMEOUT_MS+500 → forceFailStuckSync", () => {
    const start = src.indexOf("function SyncStatusRow");
    expect(start).toBeGreaterThanOrEqual(0);
    const body = src.slice(start, src.indexOf("\nfunction CloudSync", start));
    expect(body).toMatch(/sync\.status\s*!==\s*["']syncing["']/);
    expect(body).toMatch(/SYNC_TIMEOUT_MS\s*\+\s*500/);
    expect(body).toMatch(/forceFailStuckSync\(\)/);
    expect(body).toMatch(/useEffect/);
  });
});
