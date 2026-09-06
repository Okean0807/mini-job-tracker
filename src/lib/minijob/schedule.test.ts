import { describe, expect, it } from "vitest";

import { generateAbsence } from "./schedule";
import type { Job } from "./types";

describe("generateAbsence", () => {
  it("überspringt Wochenendtage ohne Festplan", () => {
    const flex: Job = {
      id: "j2",
      name: "Flex",
      color: "#111",
      rate: 12,
      mode: "flex",
      startDate: "2026-01-01",
    };
    // Fr–Mo: nur Fr + Mo (local calendar dates; no process.env.TZ mutation)
    const created = generateAbsence(flex, "krank", "2026-03-06", "2026-03-09", "BE");
    expect(created.map((s) => s.date)).toEqual(["2026-03-06", "2026-03-09"]);
  });
});
