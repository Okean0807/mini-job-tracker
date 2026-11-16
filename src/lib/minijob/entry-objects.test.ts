/** B3 – reine Gruppierung und Suche des Einsatzort-Pickers. */
import { describe, expect, it } from "vitest";

import { groupObjectsForPicker, normalizeSearch, objectUsageFromHistory } from "./entry-objects";
import type { Shift, WorkObject } from "./types";

const obj = (id: string, name: string): WorkObject => ({ id, name });
const OBJECTS = [
  obj("o1", "Bürohaus Mitte"),
  obj("o2", "Lager Nord"),
  obj("o3", "Praxis Süd"),
  obj("o4", "Aula West"),
];
const w = (id: string, date: string, objectId: string | undefined, jobId = "j1"): Shift => ({
  id,
  kind: "arbeit",
  date,
  start: "08:00",
  end: "12:00",
  breakMinutes: 0,
  jobId,
  ...(objectId ? { objectId } : {}),
});

describe("objectUsageFromHistory", () => {
  it("letzter Einsatzort = jüngster Eintrag dieses Jobs", () => {
    const shifts = [
      w("1", "2026-09-01", "o1"),
      w("2", "2026-09-05", "o2"),
      w("3", "2026-09-03", "o3"),
    ];
    expect(objectUsageFromHistory({ shifts, objects: OBJECTS, jobId: "j1" }).last).toBe("o2");
  });

  it("häufig = mindestens zweimal genutzt, meistgenutzt zuerst, ohne den letzten", () => {
    const shifts = [
      w("1", "2026-09-01", "o1"),
      w("2", "2026-09-02", "o1"),
      w("3", "2026-09-03", "o1"),
      w("4", "2026-09-04", "o3"),
      w("5", "2026-09-05", "o3"),
      w("6", "2026-09-06", "o2"),
      w("7", "2026-09-07", "o4"),
    ];
    const usage = objectUsageFromHistory({ shifts, objects: OBJECTS, jobId: "j1" });
    expect(usage.last).toBe("o4");
    expect(usage.frequent).toEqual(["o1", "o3"]);
  });

  it("Historie anderer Jobs, Abwesenheiten und fehlende Objekte fließen nicht ein", () => {
    const shifts = [
      w("1", "2026-09-01", "o1", "j2"),
      { ...w("2", "2026-09-02", "o2"), kind: "urlaub" as const },
      w("3", "2026-09-03", "gone"),
    ];
    expect(objectUsageFromHistory({ shifts, objects: OBJECTS, jobId: "j1" })).toEqual({
      last: null,
      frequent: [],
    });
    expect(objectUsageFromHistory({ shifts, objects: OBJECTS, jobId: "j2" }).last).toBe("o1");
  });

  it("excludeId ignoriert den bearbeiteten Eintrag", () => {
    const shifts = [w("1", "2026-09-01", "o1"), w("2", "2026-09-05", "o2")];
    expect(
      objectUsageFromHistory({ shifts, objects: OBJECTS, jobId: "j1", excludeId: "2" }).last,
    ).toBe("o1");
  });
});

describe("groupObjectsForPicker", () => {
  const usage = { last: "o2", frequent: ["o1"] };

  it("Gruppen ohne Duplikate; Rest alphabetisch", () => {
    const g = groupObjectsForPicker({ objects: OBJECTS, usage });
    expect(g.last?.id).toBe("o2");
    expect(g.frequent.map((o) => o.id)).toEqual(["o1"]);
    expect(g.all.map((o) => o.id)).toEqual(["o4", "o3"]);
    expect(g.flat.map((o) => o.id)).toEqual(["o2", "o1", "o4", "o3"]);
    expect(new Set(g.flat.map((o) => o.id)).size).toBe(OBJECTS.length);
  });

  it("Suche nach Namen, ohne Groß-/Kleinschreibung und Akzente", () => {
    expect(normalizeSearch("  BÜRO ")).toBe("buro");
    const g = groupObjectsForPicker({ objects: OBJECTS, usage, query: "buro" });
    expect(g.flat.map((o) => o.id)).toEqual(["o1"]);
    expect(g.last).toBeNull();
  });

  it("ein durch die Suche ausgeblendetes Objekt aus Gruppe 1/2 taucht nicht unter 'Alle' auf", () => {
    const g = groupObjectsForPicker({ objects: OBJECTS, usage, query: "west" });
    expect(g.flat.map((o) => o.id)).toEqual(["o4"]);
  });

  it("keine Treffer → leere Liste", () => {
    expect(groupObjectsForPicker({ objects: OBJECTS, usage, query: "zzz" }).flat).toEqual([]);
  });
});
