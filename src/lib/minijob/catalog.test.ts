import { beforeEach, describe, expect, it, vi } from "vitest";

import { WORK_CODE_LABELS, WORK_CODES } from "./arbeitsnachweis";
import { workFingerprint } from "./cloud";
import {
  addCustomTaskToCatalog,
  addWorkCodeToCatalog,
  applyWorkCodeToFormFields,
  ensureCustomTasksFromShifts,
  ensureWorkCodesFromShifts,
  findWorkCodeDef,
  learnSavedValuesFromShift,
  legendLabelForWorkCode,
  mergeWorkCodeCatalog,
  snapshotWorkCodeLabel,
} from "./catalog";
import {
  EMPTY_DATA,
  getData,
  replaceAll,
  saveShift,
  updateSettings,
  upsertWorkCodeDef,
} from "./store";
import { DEMO_SCOPE } from "./storage-scope";
import type { Shift } from "./types";
import { DEFAULT_SETTINGS } from "./types";

const DE_TASKS = [
  { key: "maintenance", label: "Unterhaltsreinigung" },
  { key: "windows", label: "Fensterreinigung" },
  { key: "special", label: "Sonderreinigung" },
];

function shift(over: Partial<Shift> = {}): Shift {
  return {
    id: "s1",
    kind: "arbeit",
    date: "2026-09-20",
    start: "08:00",
    end: "12:00",
    breakMinutes: 0,
    ...over,
  };
}

describe("Leistungsart catalog", () => {
  it("adds custom code + description", () => {
    const result = addWorkCodeToCatalog([], " xyz ", "  Spezialreinigung  ");
    expect(result).toEqual({
      status: "added",
      catalog: [{ code: "XYZ", label: "Spezialreinigung" }],
      item: { code: "XYZ", label: "Spezialreinigung" },
    });
  });

  it("rejects empty code or label", () => {
    expect(addWorkCodeToCatalog([], "  ", "Spezial")).toEqual({ status: "empty" });
    expect(addWorkCodeToCatalog([], "XYZ", "   ")).toEqual({ status: "empty" });
  });

  it("does not duplicate identical catalog items (trim/case)", () => {
    const catalog = [{ code: "XYZ", label: "Spezialreinigung" }];
    const result = addWorkCodeToCatalog(catalog, "xyz", " Spezialreinigung ");
    expect(result.status).toBe("exists");
    if (result.status !== "exists") return;
    expect(result.catalog).toBe(catalog);
    expect(result.item).toEqual({ code: "XYZ", label: "Spezialreinigung" });
  });

  it("does not silently overwrite the same code with a different label", () => {
    const catalog = [{ code: "XYZ", label: "Spezialreinigung" }];
    const result = addWorkCodeToCatalog(catalog, "XYZ", "Sonderobjekt");
    expect(result).toEqual({
      status: "conflict",
      existing: { code: "XYZ", label: "Spezialreinigung" },
    });
    expect(catalog).toEqual([{ code: "XYZ", label: "Spezialreinigung" }]);
  });

  it("does not copy predefined codes into the custom catalog", () => {
    const same = addWorkCodeToCatalog([], "ur", "Unterhaltsreinigung");
    expect(same.status).toBe("exists");
    if (same.status === "exists") expect(same.catalog).toEqual([]);

    const conflict = addWorkCodeToCatalog([], "UR", "Andere Bezeichnung");
    expect(conflict.status).toBe("conflict");
  });

  it("merge shows builtins plus custom without duplicating UR", () => {
    const merged = mergeWorkCodeCatalog([
      { code: "UR", label: "Unterhaltsreinigung" },
      { code: "XYZ", label: "Spezialreinigung" },
      { code: "SN", label: "Schlüssel nehmen" },
    ]);
    expect(merged.filter((c) => c.code === "UR")).toHaveLength(1);
    expect(merged.some((c) => c.code === "XYZ")).toBe(true);
    expect(merged.some((c) => c.code === "SN" && c.label === "Schlüssel nehmen")).toBe(true);
    expect(merged.map((c) => c.code).slice(0, WORK_CODES.length)).toEqual([...WORK_CODES]);
    expect(merged[0]?.label).toBe(WORK_CODE_LABELS.UR);
  });

  it("applyWorkCodeToFormFields copies code + Bezeichnung like an object", () => {
    expect(applyWorkCodeToFormFields({ code: "gl", label: "  Glasreinigung  " })).toEqual({
      workCode: "GL",
      workCodeLabel: "Glasreinigung",
    });
    expect(findWorkCodeDef([{ code: "GL", label: "Glasreinigung" }], "gl")).toEqual({
      code: "GL",
      label: "Glasreinigung",
    });
  });
});

describe("Tätigkeiten catalog", () => {
  it("adds a custom Tätigkeit", () => {
    const result = addCustomTaskToCatalog([], "  Dachfenster reinigen  ", DE_TASKS);
    expect(result).toEqual({
      status: "added",
      catalog: ["Dachfenster reinigen"],
      value: "Dachfenster reinigen",
    });
  });

  it("does not duplicate predefined labels — selects the template instead", () => {
    const result = addCustomTaskToCatalog([], "Unterhaltsreinigung", DE_TASKS);
    expect(result).toEqual({ status: "predefined", value: "#maintenance" });
  });

  it("prevents duplicate custom tasks (case/whitespace)", () => {
    const catalog = ["Dachfenster reinigen"];
    const result = addCustomTaskToCatalog(catalog, "dachfenster  reinigen", DE_TASKS);
    expect(result.status).toBe("exists");
    if (result.status !== "exists") return;
    expect(result.catalog).toBe(catalog);
    expect(result.value).toBe("Dachfenster reinigen");
  });

  it("rejects empty input", () => {
    expect(addCustomTaskToCatalog([], "   ", DE_TASKS)).toEqual({ status: "empty" });
  });
});

describe("catalog vs current entry selection", () => {
  it("deselecting a code does not remove it from the saved catalog", () => {
    const catalog = [
      { code: "XYZ", label: "Spezialreinigung" },
      { code: "SN", label: "Schlüssel nehmen" },
    ];
    let selected = "XYZ";
    selected = "";
    expect(catalog).toEqual([
      { code: "XYZ", label: "Spezialreinigung" },
      { code: "SN", label: "Schlüssel nehmen" },
    ]);
    expect(selected).toBe("");
    expect(mergeWorkCodeCatalog(catalog).some((c) => c.code === "XYZ")).toBe(true);
  });

  it("deselecting a custom task does not remove it from the saved catalog", () => {
    const catalog = ["Dachfenster reinigen"];
    let selected = ["Dachfenster reinigen"];
    selected = selected.filter((x) => x !== "Dachfenster reinigen");
    expect(selected).toEqual([]);
    expect(catalog).toEqual(["Dachfenster reinigen"]);
  });
});

describe("historical snapshots", () => {
  it("keeps the original label when the catalog later changes", () => {
    const previous = snapshotWorkCodeLabel({
      selectedCode: "XYZ",
      catalog: [{ code: "XYZ", label: "Spezialreinigung" }],
    });
    expect(previous).toBe("Spezialreinigung");

    const relabeled = snapshotWorkCodeLabel({
      selectedCode: "XYZ",
      catalog: [{ code: "XYZ", label: "Sonderobjekt" }],
      previousCode: "XYZ",
      previousLabel: "Spezialreinigung",
    });
    expect(relabeled).toBe("Spezialreinigung");
  });

  it("uses the current catalog label when the user picks a different code", () => {
    expect(
      snapshotWorkCodeLabel({
        selectedCode: "SN",
        catalog: [
          { code: "XYZ", label: "Spezialreinigung" },
          { code: "SN", label: "Schlüssel nehmen" },
        ],
        previousCode: "XYZ",
        previousLabel: "Spezialreinigung",
      }),
    ).toBe("Schlüssel nehmen");
  });

  it("PDF legend prefers the shift snapshot over a later catalog edit", () => {
    const historical = shift({
      workCode: "XYZ",
      workCodeLabel: "Spezialreinigung",
    });
    expect(
      legendLabelForWorkCode("XYZ", [historical], [{ code: "XYZ", label: "Sonderobjekt" }]),
    ).toBe("Spezialreinigung");
  });
});

describe("ensure catalogs from shifts (ADD-only)", () => {
  it("recovers custom Leistungsarten without mutating shifts", () => {
    const legacy = shift({
      workCode: "XYZ",
      workCodeLabel: "Spezialreinigung",
    });
    const catalog = ensureWorkCodesFromShifts([], [legacy]);
    expect(catalog).toEqual([{ code: "XYZ", label: "Spezialreinigung" }]);
    expect(legacy.workCodeLabel).toBe("Spezialreinigung");

    const unchanged = ensureWorkCodesFromShifts(catalog, [
      { ...legacy, workCodeLabel: "Sonderobjekt" },
    ]);
    expect(unchanged).toBe(catalog);
    expect(unchanged[0]?.label).toBe("Spezialreinigung");
  });

  it("recovers custom Tätigkeiten without mutating shifts", () => {
    const legacy = shift({ tasks: ["#maintenance", "Dachfenster reinigen"] });
    const catalog = ensureCustomTasksFromShifts([], [legacy], DE_TASKS);
    expect(catalog).toEqual(["Dachfenster reinigen"]);
    expect(legacy.tasks).toEqual(["#maintenance", "Dachfenster reinigen"]);
  });
});

describe("store persistence (settings catalogs)", () => {
  beforeEach(() => {
    replaceAll({
      ...EMPTY_DATA,
      jobs: [{ id: "j1", name: "Reinigung", color: "#0d9488", mode: "flex" }],
      settings: { ...DEFAULT_SETTINGS },
    });
  });

  it("saveShift auto-learns Leistungsart and Tätigkeit like objects", () => {
    saveShift(
      shift({
        id: "learn-1",
        jobId: "j1",
        workCode: "GL",
        workCodeLabel: "Glasreinigung",
        tasks: ["Dachfenster reinigen"],
      }),
    );
    expect(getData().settings.workCodes).toEqual([{ code: "GL", label: "Glasreinigung" }]);
    expect(getData().settings.customTasks).toEqual(["Dachfenster reinigen"]);
    expect(getData().shifts.find((s) => s.id === "learn-1")?.workCodeLabel).toBe("Glasreinigung");

    saveShift(
      shift({
        id: "learn-2",
        jobId: "j1",
        workCode: "gl",
        workCodeLabel: "  Glasreinigung ",
        tasks: ["dachfenster  reinigen"],
      }),
    );
    expect(getData().settings.workCodes).toEqual([{ code: "GL", label: "Glasreinigung" }]);
    expect(getData().settings.customTasks).toEqual(["Dachfenster reinigen"]);

    saveShift(shift({ id: "learn-3", jobId: "j1" }));
    expect(getData().settings.workCodes).toEqual([{ code: "GL", label: "Glasreinigung" }]);
    expect(getData().settings.customTasks).toEqual(["Dachfenster reinigen"]);
    expect(getData().shifts.find((s) => s.id === "learn-3")?.workCode).toBeUndefined();
  });

  it("learnSavedValuesFromShift is ADD-only and does not mutate the shift", () => {
    const entry = shift({
      workCode: "GL",
      workCodeLabel: "Glasreinigung",
      tasks: ["Dachfenster reinigen"],
    });
    const first = learnSavedValuesFromShift([], [], entry);
    expect(first.workCodes).toEqual([{ code: "GL", label: "Glasreinigung" }]);
    expect(first.customTasks).toEqual(["Dachfenster reinigen"]);
    const second = learnSavedValuesFromShift(first.workCodes, first.customTasks, {
      ...entry,
      workCodeLabel: "Andere Bezeichnung",
      tasks: ["Dachfenster reinigen", "Noch eine"],
    });
    expect(second.workCodes).toEqual([{ code: "GL", label: "Glasreinigung" }]);
    expect(second.customTasks).toEqual(["Dachfenster reinigen", "Noch eine"]);
    expect(entry.workCodeLabel).toBe("Glasreinigung");
  });

  it("keeps catalogs when an entry is saved without that selection", () => {
    updateSettings({
      workCodes: [{ code: "XYZ", label: "Spezialreinigung" }],
      customTasks: ["Dachfenster reinigen"],
    });
    saveShift(
      shift({
        id: "entry-1",
        jobId: "j1",
        workCode: "XYZ",
        workCodeLabel: "Spezialreinigung",
        tasks: ["Dachfenster reinigen"],
      }),
    );
    saveShift(shift({ id: "entry-2", jobId: "j1" }));

    expect(getData().settings.workCodes).toEqual([{ code: "XYZ", label: "Spezialreinigung" }]);
    expect(getData().settings.customTasks).toEqual(["Dachfenster reinigen"]);
    expect(getData().shifts.find((s) => s.id === "entry-1")?.workCode).toBe("XYZ");
    expect(getData().shifts.find((s) => s.id === "entry-2")?.workCode).toBeUndefined();
    expect(getData().shifts.find((s) => s.id === "entry-2")?.tasks).toBeUndefined();
  });

  it("does not rewrite historical shift labels when the catalog is edited", () => {
    replaceAll({
      ...EMPTY_DATA,
      jobs: [{ id: "j1", name: "Reinigung", color: "#0d9488", mode: "flex" }],
      shifts: [
        shift({
          id: "sep",
          jobId: "j1",
          date: "2026-09-04",
          workCode: "XYZ",
          workCodeLabel: "Spezialreinigung",
          tasks: ["Dachfenster reinigen"],
        }),
      ],
      settings: {
        ...DEFAULT_SETTINGS,
        workCodes: [{ code: "XYZ", label: "Spezialreinigung" }],
        customTasks: ["Dachfenster reinigen"],
      },
    });
    updateSettings({
      workCodes: [{ code: "XYZ", label: "Sonderobjekt" }],
    });
    const historical = getData().shifts.find((s) => s.id === "sep");
    expect(historical?.workCode).toBe("XYZ");
    expect(historical?.workCodeLabel).toBe("Spezialreinigung");
    expect(historical?.tasks).toEqual(["Dachfenster reinigen"]);
    expect(getData().settings.workCodes?.[0]?.label).toBe("Sonderobjekt");
  });

  it("upsertWorkCodeDef edits the saved list without rewriting historical shifts", () => {
    replaceAll({
      ...EMPTY_DATA,
      jobs: [{ id: "j1", name: "Reinigung", color: "#0d9488", mode: "flex" }],
      shifts: [
        shift({
          id: "hist",
          jobId: "j1",
          workCode: "GL",
          workCodeLabel: "Glasreinigung",
        }),
      ],
      settings: {
        ...DEFAULT_SETTINGS,
        workCodes: [{ code: "GL", label: "Glasreinigung" }],
      },
    });
    upsertWorkCodeDef({ code: "GL", label: "Geändert" });
    const historical = getData().shifts.find((s) => s.id === "hist");
    expect(historical?.workCodeLabel).toBe("Glasreinigung");
    expect(getData().settings.workCodes).toEqual([{ code: "GL", label: "Geändert" }]);
  });

  it("replaceAll hydrates catalogs from legacy shifts (ADD-only)", () => {
    const legacy = shift({
      id: "legacy",
      workCode: "XYZ",
      workCodeLabel: "Spezialreinigung",
      tasks: ["Dachfenster reinigen"],
    });
    replaceAll({
      ...EMPTY_DATA,
      shifts: [legacy],
      jobs: [{ id: "j1", name: "Reinigung", color: "#0d9488", mode: "flex" }],
    });
    expect(getData().settings.workCodes).toEqual([{ code: "XYZ", label: "Spezialreinigung" }]);
    expect(getData().settings.customTasks).toEqual(["Dachfenster reinigen"]);
    expect(getData().shifts[0]?.workCodeLabel).toBe("Spezialreinigung");
    expect(getData().shifts[0]?.tasks).toEqual(["Dachfenster reinigen"]);
  });

  it("demo/test mode uses the same settings persistence", () => {
    updateSettings({
      localDemoMode: true,
      workCodes: [{ code: "XYZ", label: "Spezialreinigung" }],
      customTasks: ["Dachfenster reinigen"],
    });
    expect(getData().settings.localDemoMode).toBe(true);
    expect(getData().settings.workCodes).toEqual([{ code: "XYZ", label: "Spezialreinigung" }]);
    expect(getData().settings.customTasks).toEqual(["Dachfenster reinigen"]);
  });

  it("workFingerprint is shifts+jobs only — catalog settings are excluded", () => {
    const jobs = [{ id: "j1", name: "Reinigung", color: "#0d9488", mode: "flex" as const }];
    const shifts = [shift({ jobId: "j1", workCode: "XYZ", workCodeLabel: "Spezialreinigung" })];
    const before = workFingerprint({ shifts, jobs });
    updateSettings({
      workCodes: [{ code: "XYZ", label: "Sonderobjekt" }],
      customTasks: ["Dachfenster reinigen"],
    });
    expect(workFingerprint({ shifts, jobs })).toBe(before);
    expect(getData().settings.workCodes?.[0]?.label).toBe("Sonderobjekt");
  });
});

describe("localStorage refresh", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.resetModules();
  });

  it("survives browser refresh after saveShift auto-learn", async () => {
    const store = await import("./store");
    // #114: Daten liegen im Scope-Schlüssel (hier Testmodus), nie global.
    store.loadFromStorage();
    store.activateScope(DEMO_SCOPE);
    store.replaceAll({
      ...store.EMPTY_DATA,
      jobs: [{ id: "j1", name: "Reinigung", color: "#0d9488", mode: "flex" }],
      settings: { ...DEFAULT_SETTINGS, localDemoMode: true },
    });
    store.saveShift({
      id: "gl-1",
      kind: "arbeit",
      date: "2026-09-20",
      start: "08:00",
      end: "12:00",
      breakMinutes: 0,
      jobId: "j1",
      workCode: "GL",
      workCodeLabel: "Glasreinigung",
      tasks: ["Dachfenster reinigen"],
    });
    expect(window.localStorage.getItem("minijob-tracker-v1")).toBeNull();
    const raw = window.localStorage.getItem("minijob-tracker-v1:demo");
    expect(raw).toContain("GL");
    expect(raw).toContain("Glasreinigung");
    expect(raw).toContain("Dachfenster reinigen");

    vi.resetModules();
    const reloaded = await import("./store");
    reloaded.loadFromStorage();
    expect(reloaded.getActiveScope().kind).toBe("demo");
    expect(reloaded.getData().settings.workCodes).toEqual([{ code: "GL", label: "Glasreinigung" }]);
    expect(reloaded.getData().settings.customTasks).toEqual(["Dachfenster reinigen"]);
    expect(reloaded.getData().shifts.find((s) => s.id === "gl-1")?.workCodeLabel).toBe(
      "Glasreinigung",
    );
  });

  it("survives browser refresh for both catalogs", async () => {
    const store = await import("./store");
    // #114: Daten liegen im Scope-Schlüssel (hier Testmodus), nie global.
    store.loadFromStorage();
    store.activateScope(DEMO_SCOPE);
    store.replaceAll({
      ...store.EMPTY_DATA,
      jobs: [{ id: "j1", name: "Reinigung", color: "#0d9488", mode: "flex" }],
      settings: { ...DEFAULT_SETTINGS, localDemoMode: true },
    });
    store.updateSettings({
      workCodes: [{ code: "XYZ", label: "Spezialreinigung" }],
      customTasks: ["Dachfenster reinigen"],
    });
    expect(window.localStorage.getItem("minijob-tracker-v1")).toBeNull();
    const raw = window.localStorage.getItem("minijob-tracker-v1:demo");
    expect(raw).toContain("XYZ");
    expect(raw).toContain("Spezialreinigung");
    expect(raw).toContain("Dachfenster reinigen");

    vi.resetModules();
    const reloaded = await import("./store");
    reloaded.loadFromStorage();
    expect(reloaded.getActiveScope().kind).toBe("demo");
    expect(reloaded.getData().settings.workCodes).toEqual([
      { code: "XYZ", label: "Spezialreinigung" },
    ]);
    expect(reloaded.getData().settings.customTasks).toEqual(["Dachfenster reinigen"]);
    expect(reloaded.getData().settings.localDemoMode).toBe(true);
  });
});
