import { afterAll, describe, expect, it } from "vitest";

import { assertCalendarGoldens } from "./__fixtures__/period-calendar-goldens";

/**
 * Führt die Golden-Checks im selben Prozess unter mehreren Zeitzonen aus
 * (Node übernimmt `process.env["TZ"]` zur Laufzeit). So sind Berlin, Los Angeles
 * und Kiritimati (UTC+14) auch im normalen CI-Lauf (`bun run test`) abgedeckt,
 * ohne die Vitest-/CI-Konfiguration zu ändern. Die Sanity-Prüfung stellt
 * sicher, dass der TZ-Wechsel wirklich wirkt.
 */
const ORIGINAL_TZ = process.env["TZ"];

const ZONES = [
  // [Zone, Offset 25.10.2026 00:30 lokal (noch Sommerzeit), Offset 26.10.2026 12:00]
  ["Europe/Berlin", -120, -60],
  ["America/Los_Angeles", 420, 420],
  ["Pacific/Kiritimati", -840, -840],
  ["UTC", 0, 0],
] as const;

describe("period helpers: Zeitzonen-Matrix", () => {
  afterAll(() => {
    if (ORIGINAL_TZ === undefined) delete process.env["TZ"];
    else process.env["TZ"] = ORIGINAL_TZ;
  });

  it.each(ZONES)("%s: TZ aktiv und alle Golden-Werte identisch", (zone, before, after) => {
    process.env["TZ"] = zone;
    expect(new Date(2026, 9, 25, 0, 30).getTimezoneOffset()).toBe(before);
    expect(new Date(2026, 9, 26, 12).getTimezoneOffset()).toBe(after);
    assertCalendarGoldens();
  });

  it("Europe/Berlin: naives +24 h ab 19.10. doppelt den 25.10. und verliert den 26.10. (Gegenprobe)", () => {
    process.env["TZ"] = "Europe/Berlin";
    const naive: string[] = [];
    let t = new Date(2026, 9, 19).getTime();
    for (let i = 0; i < 8; i++) {
      const d = new Date(t);
      naive.push(
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
      );
      t += 86_400_000;
    }
    // Belegt, dass der Test die DST-Falle tatsächlich erreichen würde.
    expect(naive.slice(-2)).toEqual(["2026-10-25", "2026-10-25"]);
    expect(naive).not.toContain("2026-10-26");
  });
});
