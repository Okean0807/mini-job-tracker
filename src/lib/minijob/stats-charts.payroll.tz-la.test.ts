import { describe, expect, it } from "vitest";

import { assertChartGoldens } from "./__fixtures__/stats-chart-goldens";

// Läuft mit TZ=America/Los_Angeles (vitest project "tz-la", auch in CI).
describe("B1 Tagesdiagramme in America/Los_Angeles", () => {
  it("TZ ist wirklich hinter UTC", () => {
    expect(new Date(2026, 9, 25, 12).getTimezoneOffset()).toBe(420);
  });

  it("Golden-Werte (Sep 2026, DST) identisch", () => {
    assertChartGoldens();
  });
});
