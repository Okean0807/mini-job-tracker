/**
 * Paket A: Prüfungen des Eintrags-Editors.
 *
 * Geprüft wird, WAS gemeldet wird (Codes und Schweregrad) – und ausdrücklich, dass der
 * Rechenkern davon unberührt bleibt: `shiftHours` liefert für die blockierten Fälle weiter
 * genau das, was es vorher geliefert hat.
 */
import { describe, expect, it } from "vitest";

import { shiftHours } from "./calc";
import {
  dstTransitionMinute,
  EMPTY_VALIDATION,
  fieldIssues,
  validateEntry,
  type EntryDraft,
} from "./entry-validate";
import type { Shift } from "./types";

const DAY = "2026-09-24";

function draft(partial: Partial<EntryDraft> = {}): EntryDraft {
  return {
    kind: "arbeit",
    jobId: "j1",
    date: DAY,
    start: "09:00",
    end: "17:00",
    breakMinutes: 30,
    ...partial,
  };
}

function work(partial: Partial<Shift> & { id: string }): Shift {
  return {
    kind: "arbeit",
    date: DAY,
    start: "08:00",
    end: "12:00",
    breakMinutes: 0,
    jobId: "j1",
    ...partial,
  } as Shift;
}

const codes = (list: { code: string }[]) => list.map((i) => i.code);

describe("gültige Einträge", () => {
  it("ein normaler Eintrag ist ohne Befund", () => {
    const result = validateEntry(draft(), { shifts: [] });
    expect(result).toEqual(EMPTY_VALIDATION);
  });

  it("Abwesenheiten werden nicht geprüft (Zeiten kommen aus dem Wochenplan)", () => {
    for (const kind of ["urlaub", "krank", "feiertag", "frei", "sonstige"] as const) {
      const result = validateEntry(draft({ kind, start: "", end: "", breakMinutes: 9999 }), {
        shifts: [],
      });
      expect(result).toEqual(EMPTY_VALIDATION);
    }
  });

  it("Berühren (Ende = Beginn) ist keine Überschneidung – genau das macht der Zeit-Anschluss", () => {
    const shifts = [work({ id: "a", start: "08:00", end: "10:30" })];
    const result = validateEntry(draft({ start: "10:30", end: "12:00", breakMinutes: 0 }), {
      shifts,
    });
    expect(result.warnings).toEqual([]);
    expect(result.errors).toEqual([]);
  });
});

describe("blockierende Befunde", () => {
  it("fehlende Zeiten", () => {
    expect(codes(validateEntry(draft({ start: "" }), {}).errors)).toEqual(["start-missing"]);
    expect(codes(validateEntry(draft({ end: "" }), {}).errors)).toEqual(["end-missing"]);
    const both = validateEntry(draft({ start: "", end: "" }), {}).errors;
    expect(codes(both)).toEqual(["start-missing", "end-missing"]);
  });

  it("unmögliche Uhrzeiten", () => {
    expect(codes(validateEntry(draft({ start: "25:00" }), {}).errors)).toEqual(["invalid-start"]);
    expect(codes(validateEntry(draft({ end: "12:60" }), {}).errors)).toEqual(["invalid-end"]);
    expect(codes(validateEntry(draft({ end: "abc" }), {}).errors)).toEqual(["invalid-end"]);
  });

  it("(15) Dauer 0: blockiert – der Kern hätte still 0 Stunden gespeichert", () => {
    const result = validateEntry(draft({ start: "09:00", end: "09:00", breakMinutes: 0 }), {});
    expect(codes(result.errors)).toEqual(["zero-duration"]);
    expect(fieldIssues(result).end?.code).toBe("zero-duration");
    // Unveränderter Kern: 0 Stunden, keine 24.
    expect(shiftHours({ start: "09:00", end: "09:00", breakMinutes: 0 } as Shift)).toBe(0);
  });

  it("(17) Pause länger als die Arbeitszeit: blockiert – der Kern hätte auf 0 geklemmt", () => {
    const result = validateEntry(draft({ start: "09:00", end: "11:00", breakMinutes: 120 }), {});
    expect(codes(result.errors)).toEqual(["break-too-long"]);
    expect(fieldIssues(result).break?.vars).toMatchObject({ break: 120, gross: 120 });
    expect(shiftHours({ start: "09:00", end: "11:00", breakMinutes: 180 } as Shift)).toBe(0);
  });

  it("Pause genau gleich der Arbeitszeit ist ebenfalls 0 und blockiert", () => {
    expect(
      codes(validateEntry(draft({ start: "09:00", end: "10:00", breakMinutes: 60 }), {}).errors),
    ).toEqual(["break-too-long"]);
  });

  it("Pause knapp unter der Arbeitszeit bleibt erlaubt", () => {
    expect(
      validateEntry(draft({ start: "09:00", end: "10:00", breakMinutes: 59 }), {}).errors,
    ).toEqual([]);
  });
});

describe("(13) Nachtschichten", () => {
  it("eine legitime Nachtschicht wird NIE abgelehnt, nur als Folgetag gemeldet", () => {
    const result = validateEntry(draft({ start: "22:00", end: "02:00", breakMinutes: 0 }), {});
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(codes(result.infos)).toContain("ends-next-day");
    expect(result.infos[0]?.vars).toMatchObject({ minutes: 240 });
  });

  it("Ende vor Beginn mit mehr als 12 Stunden gilt als Tippfehler-Verdacht (bestätigbar)", () => {
    const result = validateEntry(draft({ start: "09:00", end: "08:00", breakMinutes: 0 }), {});
    expect(result.errors).toEqual([]);
    expect(codes(result.warnings)).toEqual(["overnight-long"]);
    expect(result.warnings[0]?.vars).toMatchObject({ minutes: 23 * 60 });
  });

  it("eine lange TAGschicht ist kein Verdachtsfall", () => {
    const result = validateEntry(draft({ start: "06:00", end: "19:00", breakMinutes: 30 }), {});
    expect(result.warnings).toEqual([]);
    expect(result.infos).toEqual([]);
  });
});

describe("(14) Überschneidungen", () => {
  it("meldet die kollidierende Zeit und blockiert nicht hart", () => {
    const shifts = [work({ id: "a", start: "08:00", end: "12:00" })];
    const result = validateEntry(draft({ start: "11:00", end: "15:00", breakMinutes: 0 }), {
      shifts,
    });
    expect(result.errors).toEqual([]);
    expect(codes(result.warnings)).toEqual(["overlap"]);
    expect(result.warnings[0]?.vars).toMatchObject({ start: "08:00", end: "12:00", date: DAY });
  });

  it("erkennt eine Überschneidung auch über die Jobs hinweg (man arbeitet nicht doppelt)", () => {
    const shifts = [work({ id: "a", jobId: "j2", start: "08:00", end: "12:00" })];
    expect(
      codes(
        validateEntry(draft({ start: "10:00", end: "14:00", breakMinutes: 0 }), { shifts })
          .warnings,
      ),
    ).toEqual(["overlap"]);
  });

  it("erkennt eine Überschneidung mit einer Nachtschicht des Vortags", () => {
    const shifts = [work({ id: "a", date: "2026-09-23", start: "22:00", end: "06:00" })];
    expect(
      codes(
        validateEntry(draft({ start: "05:00", end: "09:00", breakMinutes: 0 }), { shifts })
          .warnings,
      ),
    ).toEqual(["overlap"]);
  });

  it("der eigene Eintrag beim Bearbeiten überschneidet sich nicht mit sich selbst", () => {
    const shifts = [work({ id: "a", start: "08:00", end: "12:00" })];
    const result = validateEntry(
      draft({ id: "a", start: "08:00", end: "12:00", breakMinutes: 0 }),
      {
        shifts,
      },
    );
    expect(result.warnings).toEqual([]);
  });

  it("Abwesenheiten erzeugen keine Überschneidung", () => {
    const shifts = [work({ id: "u", kind: "urlaub", start: "09:00", end: "17:00" })];
    expect(validateEntry(draft({ start: "10:00", end: "14:00" }), { shifts }).warnings).toEqual([]);
  });

  it("ein Eintrag an einem anderen Tag überschneidet sich nicht", () => {
    const shifts = [work({ id: "a", date: "2026-09-20", start: "08:00", end: "12:00" })];
    expect(validateEntry(draft({ start: "08:00", end: "12:00" }), { shifts }).warnings).toEqual([]);
  });
});

describe("(16) Dubletten", () => {
  it("ein identischer Eintrag wird gemeldet (bestätigbar, nicht blockiert)", () => {
    const shifts = [work({ id: "a", start: "09:00", end: "17:00", breakMinutes: 30 })];
    const result = validateEntry(draft({ start: "09:00", end: "17:00", breakMinutes: 30 }), {
      shifts,
    });
    expect(result.errors).toEqual([]);
    expect(codes(result.warnings)).toContain("duplicate");
  });

  it("ein abweichendes Feld ist keine Dublette", () => {
    const shifts = [work({ id: "a", start: "09:00", end: "17:00", breakMinutes: 30, note: "A" })];
    expect(
      codes(
        validateEntry(draft({ start: "09:00", end: "17:00", breakMinutes: 30, note: "B" }), {
          shifts,
        }).warnings,
      ),
    ).not.toContain("duplicate");
  });

  it("derselbe Eintrag eines anderen Jobs ist keine Dublette", () => {
    const shifts = [work({ id: "a", jobId: "j2", start: "09:00", end: "17:00", breakMinutes: 30 })];
    expect(
      codes(
        validateEntry(draft({ start: "09:00", end: "17:00", breakMinutes: 30 }), { shifts })
          .warnings,
      ),
    ).not.toContain("duplicate");
  });

  it("beim Bearbeiten ist der eigene Eintrag keine Dublette", () => {
    const shifts = [work({ id: "a", start: "09:00", end: "17:00", breakMinutes: 30 })];
    expect(
      validateEntry(draft({ id: "a", start: "09:00", end: "17:00", breakMinutes: 30 }), { shifts })
        .warnings,
    ).toEqual([]);
  });
});

describe("Zeitumstellung (nur Hinweis, Rechenkern unverändert)", () => {
  it("erkennt die Umstellungstage 2026 in Europe/Berlin", () => {
    expect(dstTransitionMinute("2026-03-29")).toBe(120); // 02:00 -> 03:00
    expect(dstTransitionMinute("2026-10-25")).toBe(180); // 03:00 -> 02:00
    expect(dstTransitionMinute("2026-09-24")).toBeNull();
  });

  it("ein Eintrag über die Umstellung bekommt einen Hinweis, aber keinen Fehler", () => {
    const result = validateEntry(
      draft({ date: "2026-03-29", start: "01:00", end: "05:00", breakMinutes: 0 }),
      {},
    );
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(codes(result.infos)).toContain("dst-transition");
  });

  it("ein Eintrag am Umstellungstag ausserhalb des Umstellungsfensters bekommt keinen Hinweis", () => {
    const result = validateEntry(
      draft({ date: "2026-03-29", start: "09:00", end: "17:00", breakMinutes: 0 }),
      {},
    );
    expect(codes(result.infos)).not.toContain("dst-transition");
  });

  it("eine Nachtschicht in die Umstellung hinein bekommt den Hinweis", () => {
    const result = validateEntry(
      draft({ date: "2026-10-24", start: "22:00", end: "06:00", breakMinutes: 0 }),
      {},
    );
    expect(codes(result.infos)).toContain("dst-transition");
  });

  it("eine Nachtschicht, die vor der Umstellung endet, bekommt keinen Hinweis", () => {
    const result = validateEntry(
      draft({ date: "2026-10-24", start: "20:00", end: "01:00", breakMinutes: 0 }),
      {},
    );
    expect(codes(result.infos)).not.toContain("dst-transition");
  });

  it("der Rechenkern rechnet unverändert mit Uhrzeiten (keine 23/25-Stunden-Korrektur)", () => {
    expect(
      shiftHours({ date: "2026-03-29", start: "01:00", end: "05:00", breakMinutes: 0 } as Shift),
    ).toBe(4);
  });
});

describe("mehrere Befunde zugleich", () => {
  it("Fehler haben Vorrang: bei Dauer 0 wird nicht zusätzlich nach Dubletten gesucht", () => {
    const shifts = [work({ id: "a", start: "09:00", end: "09:00", breakMinutes: 0 })];
    const result = validateEntry(draft({ start: "09:00", end: "09:00", breakMinutes: 0 }), {
      shifts,
    });
    expect(codes(result.errors)).toEqual(["zero-duration"]);
    expect(result.warnings).toEqual([]);
  });

  it("Überschneidung und Dublette können gemeinsam gemeldet werden", () => {
    const shifts = [work({ id: "a", start: "09:00", end: "17:00", breakMinutes: 30 })];
    const result = validateEntry(draft({ start: "09:00", end: "17:00", breakMinutes: 30 }), {
      shifts,
    });
    expect(codes(result.warnings).sort()).toEqual(["duplicate", "overlap"]);
  });

  it("ohne Bestand wird nur der Entwurf geprüft", () => {
    expect(validateEntry(draft(), {})).toEqual(EMPTY_VALIDATION);
  });
});

describe("F1 Altbestand: schon so gespeicherte Dauer/Pause", () => {
  // Bestehender Arbeitseintrag, gespeichert mit Pause >= Arbeitszeit (09:00–10:00, 120 Min.).
  const storedBreak = work({ id: "legacy", start: "09:00", end: "10:00", breakMinutes: 120 });
  // Bestehender Arbeitseintrag, gespeichert mit Beginn = Ende.
  const storedZero = work({ id: "zero", start: "09:00", end: "09:00", breakMinutes: 0 });

  it("unverändert gespeichert: kein Fehler, nur ein Hinweis (Pause >= Arbeitszeit)", () => {
    const result = validateEntry(
      draft({ id: "legacy", start: "09:00", end: "10:00", breakMinutes: 120 }),
      { shifts: [storedBreak], original: storedBreak },
    );
    expect(result.errors).toEqual([]);
    expect(codes(result.infos)).toContain("legacy-break-too-long");
  });

  it("unverändert gespeichert: kein Fehler, nur ein Hinweis (Dauer 0)", () => {
    const result = validateEntry(
      draft({ id: "zero", start: "09:00", end: "09:00", breakMinutes: 0 }),
      { shifts: [storedZero], original: storedZero },
    );
    expect(result.errors).toEqual([]);
    expect(codes(result.infos)).toEqual(["legacy-zero-duration"]);
  });

  it("Datum, Job oder Notiz dürfen sich ändern – es zählen nur Beginn, Ende und Pause", () => {
    const result = validateEntry(
      draft({
        id: "legacy",
        jobId: "j2",
        date: "2026-09-25",
        note: "nur die Notiz geändert",
        start: "09:00",
        end: "10:00",
        breakMinutes: 120,
      }),
      { shifts: [storedBreak], original: storedBreak },
    );
    expect(result.errors).toEqual([]);
  });

  it("geänderter Beginn, weiter ungültig: wieder streng blockiert", () => {
    const result = validateEntry(
      draft({ id: "legacy", start: "09:15", end: "10:00", breakMinutes: 120 }),
      { shifts: [storedBreak], original: storedBreak },
    );
    expect(codes(result.errors)).toEqual(["break-too-long"]);
  });

  it("geändertes Ende, weiter ungültig: blockiert", () => {
    const result = validateEntry(
      draft({ id: "legacy", start: "09:00", end: "10:30", breakMinutes: 120 }),
      { shifts: [storedBreak], original: storedBreak },
    );
    expect(codes(result.errors)).toEqual(["break-too-long"]);
  });

  it("geänderte Pause, weiter ungültig: blockiert", () => {
    const result = validateEntry(
      draft({ id: "legacy", start: "09:00", end: "10:00", breakMinutes: 90 }),
      { shifts: [storedBreak], original: storedBreak },
    );
    expect(codes(result.errors)).toEqual(["break-too-long"]);
  });

  it("geänderte Zeiten, die gültig werden: kein Fehler und kein Altbestand-Hinweis", () => {
    const result = validateEntry(
      draft({ id: "legacy", start: "09:00", end: "10:00", breakMinutes: 15 }),
      { shifts: [storedBreak], original: storedBreak },
    );
    expect(result.errors).toEqual([]);
    expect(codes(result.infos)).not.toContain("legacy-break-too-long");
  });

  it("aus Dauer 0 wird durch geändertes Ende ein gültiger Eintrag", () => {
    const result = validateEntry(
      draft({ id: "zero", start: "09:00", end: "11:00", breakMinutes: 0 }),
      { shifts: [storedZero], original: storedZero },
    );
    expect(result.errors).toEqual([]);
    expect(result.infos).toEqual([]);
  });

  it("ein NEUER Eintrag wird immer streng geprüft – auch mit identischen Werten", () => {
    const result = validateEntry(draft({ start: "09:00", end: "10:00", breakMinutes: 120 }), {
      shifts: [storedBreak],
      original: storedBreak,
    });
    expect(codes(result.errors)).toEqual(["break-too-long"]);
  });

  it("ohne gespeicherte Fassung (Eintrag nicht mehr vorhanden) wird streng geprüft", () => {
    const result = validateEntry(
      draft({ id: "legacy", start: "09:00", end: "10:00", breakMinutes: 120 }),
      { shifts: [] },
    );
    expect(codes(result.errors)).toEqual(["break-too-long"]);
  });

  it("die gespeicherte Fassung eines ANDEREN Eintrags zählt nicht", () => {
    const other = work({ id: "other", start: "09:00", end: "10:00", breakMinutes: 120 });
    const result = validateEntry(
      draft({ id: "legacy", start: "09:00", end: "10:00", breakMinutes: 120 }),
      { shifts: [other], original: other },
    );
    expect(codes(result.errors)).toEqual(["break-too-long"]);
  });

  it("eine gespeicherte Abwesenheit, die zur Arbeit wird, gilt nicht als Altbestand", () => {
    const absence = work({
      id: "abs",
      kind: "urlaub",
      start: "09:00",
      end: "10:00",
      breakMinutes: 120,
    });
    const result = validateEntry(
      draft({ id: "abs", start: "09:00", end: "10:00", breakMinutes: 120 }),
      { shifts: [absence], original: absence },
    );
    expect(codes(result.errors)).toEqual(["break-too-long"]);
  });

  it("Überschneidungen und Dubletten werden beim Altbestand weiter zur Bestätigung gemeldet (F2)", () => {
    const neighbour = work({ id: "n", start: "08:00", end: "12:00" });
    const result = validateEntry(
      draft({ id: "legacy", start: "09:00", end: "10:00", breakMinutes: 120 }),
      { shifts: [storedBreak, neighbour], original: storedBreak },
    );
    expect(result.errors).toEqual([]);
    expect(codes(result.warnings)).toEqual(["overlap"]);
  });

  it("die Prüfung verändert die gespeicherte Fassung nicht", () => {
    const snapshot = JSON.stringify(storedBreak);
    validateEntry(draft({ id: "legacy", start: "09:00", end: "10:00", breakMinutes: 120 }), {
      shifts: [storedBreak],
      original: storedBreak,
    });
    expect(JSON.stringify(storedBreak)).toBe(snapshot);
  });
});
