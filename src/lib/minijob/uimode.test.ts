import { beforeEach, describe, expect, it } from "vitest";

import { getData, replaceAll, updateSettings } from "./store";
import { DEFAULT_SETTINGS } from "./types";
import {
  featuresForMode,
  isPreviewPending,
  previewVisibility,
  visible,
  UI_MODES,
} from "./uimode";

describe("uiMode visibility map", () => {
  it("exposes progressive features Einfach → Standard → Profi", () => {
    expect(visible("nav.stats", "simple")).toBe(true);
    expect(visible("nav.jobs", "simple")).toBe(false);
    expect(visible("nav.ai", "simple")).toBe(false);
    expect(visible("nav.docs", "simple")).toBe(false);
    expect(visible("settings.advanced", "simple")).toBe(false);

    expect(visible("nav.jobs", "standard")).toBe(true);
    expect(visible("nav.ai", "standard")).toBe(true);
    expect(visible("nav.docs", "standard")).toBe(true);
    expect(visible("dash.goals", "standard")).toBe(true);
    expect(visible("settings.advanced", "standard")).toBe(false);

    expect(visible("settings.advanced", "pro")).toBe(true);
    expect(featuresForMode("pro").length).toBeGreaterThan(featuresForMode("simple").length);
  });

  it("previewVisibility mirrors visible() for all preview features", () => {
    for (const mode of UI_MODES) {
      const map = previewVisibility(mode);
      for (const [feature, on] of Object.entries(map)) {
        expect(on).toBe(visible(feature as never, mode));
      }
    }
  });
});

describe("preview vs apply", () => {
  it("marks preview pending only when selection differs from applied", () => {
    expect(isPreviewPending("standard", null)).toBe(false);
    expect(isPreviewPending("standard", "standard")).toBe(false);
    expect(isPreviewPending("standard", "simple")).toBe(true);
    expect(isPreviewPending("pro", "simple")).toBe(true);
  });
});

describe("uiMode persist without data loss", () => {
  beforeEach(() => {
    replaceAll({
      shifts: [
        {
          id: "s1",
          kind: "arbeit",
          date: "2026-09-01",
          start: "09:00",
          end: "12:00",
          breakMinutes: 0,
          rate: 14,
        },
      ],
      jobs: [{ id: "j1", name: "Job", color: "#000", mode: "flex" }],
      settings: { ...DEFAULT_SETTINGS, uiMode: "standard", onboarded: true },
    });
  });

  it("switching uiMode persists and keeps shifts/jobs", () => {
    updateSettings({ uiMode: "simple" });
    expect(getData().settings.uiMode).toBe("simple");
    expect(getData().shifts).toHaveLength(1);
    expect(getData().jobs).toHaveLength(1);

    updateSettings({ uiMode: "pro" });
    expect(getData().settings.uiMode).toBe("pro");
    expect(getData().shifts[0]?.id).toBe("s1");
    expect(getData().jobs[0]?.id).toBe("j1");
  });
});
