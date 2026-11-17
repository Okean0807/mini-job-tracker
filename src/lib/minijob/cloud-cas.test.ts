/**
 * Phase 4 – bedingtes Schreiben (CAS) der Cloud-Sicherung, gegen ein Double.
 * ACHTUNG: Das ist KEIN Beweis für das echte PostgREST-Verhalten (siehe Kopf von cloud-cas.ts).
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  casWrite,
  nextToken,
  resolvePendingWrite,
  sameInstant,
  type BackupsTable,
  type CasResponse,
  type PendingWrite,
} from "./cloud-cas";

const OBSERVED = "2026-10-27T19:28:52.738+00:00";

interface Call {
  op: "insert" | "update" | "select" | "upsert";
  eq: [string, string][];
  row?: unknown;
}

function table(response: () => CasResponse | Promise<CasResponse>): {
  table: BackupsTable;
  calls: Call[];
} {
  const calls: Call[] = [];
  const t = {
    select: () => {
      calls.push({ op: "select", eq: [] });
      throw new Error("not used");
    },
    insert: (row: unknown) => {
      const call: Call = { op: "insert", eq: [], row };
      calls.push(call);
      return { select: async () => response() };
    },
    update: (row: unknown) => {
      const call: Call = { op: "update", eq: [], row };
      calls.push(call);
      const chain = {
        eq: (c: string, v: string) => {
          call.eq.push([c, v]);
          return chain;
        },
        select: async () => response(),
      };
      return chain;
    },
  } as unknown as BackupsTable;
  return { table: t, calls };
}

const ok = (updated_at: string): CasResponse => ({ data: [{ updated_at }], error: null });
const input = (t: BackupsTable, observedToken: string | null) => ({
  table: t,
  userId: "u1",
  observedToken,
  payload: { shifts: [] },
  token: "2026-11-17T10:00:00.000Z",
});

describe("Update (bestehende Zeile)", () => {
  it("genau eine Zeile → written; Token ist der vom Server zurückgegebene", async () => {
    const { table: t, calls } = table(() => ok("2026-11-17T10:00:00+00:00"));
    const r = await casWrite(input(t, OBSERVED));
    expect(r).toMatchObject({
      kind: "written",
      mode: "update",
      token: "2026-11-17T10:00:00+00:00",
    });
    // Bedingung: user_id UND der exakt beobachtete updated_at-String.
    expect(calls).toHaveLength(1);
    expect(calls[0]!.eq).toEqual([
      ["user_id", "u1"],
      ["updated_at", OBSERVED],
    ]);
  });

  it("null Zeilen → stale (Stand verändert oder verschwunden), nie Erfolg", async () => {
    const { table: t } = table(() => ({ data: [], error: null }));
    expect(await casWrite(input(t, OBSERVED))).toEqual({ kind: "stale", reason: "zero-rows" });
  });

  it("mehr als eine Zeile oder fehlender Token ist NICHT Erfolg (unerwartet → ambiguous)", async () => {
    const two = table(() => ({ data: [{ updated_at: "a" }, { updated_at: "b" }], error: null }));
    expect((await casWrite(input(two.table, OBSERVED))).kind).toBe("ambiguous");
    const noToken = table(() => ({ data: [{}], error: null }));
    expect((await casWrite(input(noToken.table, OBSERVED))).kind).toBe("ambiguous");
    const notArray = table(() => ({ data: null, error: null }));
    expect((await casWrite(input(notArray.table, OBSERVED))).kind).toBe("ambiguous");
  });
});

describe("Insert (keine Zeile)", () => {
  it("Erfolg → written/insert; nur .insert(), nie ein Update oder Upsert", async () => {
    const { table: t, calls } = table(() => ok("2026-11-17T10:00:00+00:00"));
    const r = await casWrite(input(t, null));
    expect(r).toMatchObject({ kind: "written", mode: "insert" });
    expect(calls.map((c) => c.op)).toEqual(["insert"]);
    expect(calls[0]!.row).toMatchObject({ user_id: "u1", updated_at: "2026-11-17T10:00:00.000Z" });
  });

  it("23505 (Zeile erschien parallel) → stale, neu vorbereiten", async () => {
    const { table: t } = table(() => ({ data: null, error: { code: "23505", message: "dup" } }));
    expect(await casWrite(input(t, null))).toEqual({ kind: "stale", reason: "unique-violation" });
  });

  it("23503 (Konto existiert nicht mehr) → account-gone", async () => {
    const { table: t } = table(() => ({ data: null, error: { code: "23503" } }));
    expect(await casWrite(input(t, null))).toEqual({ kind: "account-gone" });
  });
});

describe("Fehlerklassen", () => {
  it.each(["42501", "401", "403", "PGRST301"])(
    "Code %s → forbidden (RLS/Auth, sichere Meldung)",
    async (code) => {
      const { table: t } = table(() => ({ data: null, error: { code, message: "secret detail" } }));
      expect(await casWrite(input(t, OBSERVED))).toEqual({ kind: "forbidden" });
    },
  );

  it("eindeutiger Datenbankfehler → error mit Code, ohne Nutzdaten", async () => {
    const { table: t } = table(() => ({
      data: null,
      error: { code: "57014", message: "timeout stmt" },
    }));
    expect(await casWrite(input(t, OBSERVED))).toEqual({ kind: "error", code: "57014" });
  });

  it("Fehler ohne Datenbankcode (Netzwerk) → ambiguous", async () => {
    const { table: t } = table(() => ({ data: null, error: { message: "Failed to fetch" } }));
    expect((await casWrite(input(t, OBSERVED))).kind).toBe("ambiguous");
  });

  it("Ausnahme (z. B. Abbruch) → ambiguous; casWrite wirft nie", async () => {
    const { table: t } = table(() => {
      throw new TypeError("network");
    });
    await expect(casWrite(input(t, OBSERVED))).resolves.toEqual({ kind: "ambiguous" });
  });

  it("KEIN blindes Wiederholen: genau ein Zugriff, auch bei ambiguous", async () => {
    const { table: t, calls } = table(() => ({
      data: null,
      error: { message: "Failed to fetch" },
    }));
    await casWrite(input(t, OBSERVED));
    expect(calls).toHaveLength(1);
  });
});

describe("neuer Token", () => {
  it("ist immer verschieden vom beobachteten (auch bei gleicher Millisekunde und zurückgehender Uhr)", () => {
    const base = Date.parse(OBSERVED);
    for (const now of [base, base - 5_000, base + 1, base + 10_000]) {
      const token = nextToken(OBSERVED, now);
      expect(sameInstant(token, OBSERVED)).toBe(false);
      expect(Date.parse(token)).toBeGreaterThan(base);
    }
  });

  it("ohne beobachteten Token: aktuelle Zeit", () => {
    expect(nextToken(null, 1_000)).toBe(new Date(1_000).toISOString());
  });

  it("sameInstant vergleicht den Zeitpunkt, nicht die Schreibweise (Z vs. +00:00)", () => {
    expect(sameInstant("2026-10-27T19:28:52.738Z", "2026-10-27T19:28:52.738+00:00")).toBe(true);
    expect(sameInstant("2026-10-27T19:28:52.738Z", "2026-10-27T19:28:52.739Z")).toBe(false);
    expect(sameInstant(null, "2026-10-27T19:28:52.738Z")).toBe(false);
  });
});

describe("unklares Ergebnis (Timeout) – nächste Inspektion", () => {
  const pending: PendingWrite = {
    observedToken: OBSERVED,
    attemptedToken: "2026-11-17T10:00:00.000Z",
    fingerprint: "fp-attempt",
    at: 1,
  };

  it("gleicher Token UND gleicher Inhalt → übernehmen", () => {
    expect(
      resolvePendingWrite(pending, {
        token: "2026-11-17T10:00:00+00:00",
        fingerprint: "fp-attempt",
      }),
    ).toBe("adopt");
  });

  it("gleicher Token, aber anderer Inhalt → Konflikt (nie übernehmen)", () => {
    expect(
      resolvePendingWrite(pending, { token: "2026-11-17T10:00:00+00:00", fingerprint: "other" }),
    ).toBe("conflict");
  });

  it("beobachteter Token unverändert → nicht angekommen (neu vorbereiten)", () => {
    expect(resolvePendingWrite(pending, { token: OBSERVED, fingerprint: "x" })).toBe("not-landed");
  });

  it("anderer Token → Konflikt", () => {
    expect(resolvePendingWrite(pending, { token: "2026-12-01T00:00:00Z", fingerprint: "x" })).toBe(
      "conflict",
    );
  });

  it("Zeile verschwunden: bei Insert-Versuch nicht angekommen, sonst Konflikt", () => {
    expect(resolvePendingWrite({ ...pending, observedToken: null }, null)).toBe("not-landed");
    expect(resolvePendingWrite(pending, null)).toBe("conflict");
  });
});

describe("kein upsert im Cloud-Schreibpfad (Quelltext)", () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  it.each(["cloud.ts", "cloud-cas.ts", "guarded-operation.ts", "guarded-local.ts"])(
    "%s",
    (file) => {
      const src = strip(readFileSync(`${process.cwd()}/src/lib/minijob/${file}`, "utf8"));
      expect(src).not.toMatch(/\.upsert\s*\(/);
    },
  );

  it("außerhalb von Tests ruft nichts in src/ `.upsert(` auf der Tabelle backups auf", () => {
    const out = execSync(
      `grep -rln "from(\\"backups\\")" src --include=*.ts --include=*.tsx | grep -v "\\.test\\." || true`,
      { cwd: process.cwd(), encoding: "utf8" },
    );
    for (const file of out.split("\n").filter(Boolean)) {
      expect(strip(readFileSync(`${process.cwd()}/${file}`, "utf8"))).not.toMatch(/\.upsert\s*\(/);
    }
  });
});

/* ===================================================== Stage 1: serverseitige Revision */

import { isMissingRevColumnError, parseRev } from "./cloud-cas";

function recordingTable(response: () => CasResponse) {
  const log: { op: string; eq: [string, string][]; columns?: string }[] = [];
  const t = {
    select: () => {
      throw new Error("not used");
    },
    insert: () => ({
      select: async (columns: string) => {
        log.push({ op: "insert", eq: [], columns });
        return response();
      },
    }),
    update: () => {
      const entry: { op: string; eq: [string, string][]; columns?: string } = {
        op: "update",
        eq: [],
      };
      log.push(entry);
      const chain = {
        eq: (c: string, v: string) => {
          entry.eq.push([c, v]);
          return chain;
        },
        select: async (columns: string) => {
          entry.columns = columns;
          return response();
        },
      };
      return chain;
    },
  } as unknown as BackupsTable;
  return { table: t, log };
}
const REV_OK = (rev: unknown): CasResponse => ({
  data: [{ updated_at: "2026-11-17T10:00:00+00:00", rev }],
  error: null,
});

describe("Revisions-CAS", () => {
  const base = { userId: "u1", payload: {}, token: "2026-11-17T10:00:00.000Z" };

  it("Update filtert auf user_id + beobachtete rev (nicht auf updated_at) und liefert die neue rev", async () => {
    const { table, log } = recordingTable(() => REV_OK(1794901882456070));
    const out = await casWrite({
      ...base,
      table,
      observedToken: OBSERVED,
      observedRev: "1794901882456066",
      useRev: true,
    });
    expect(out).toMatchObject({ kind: "written", mode: "update", rev: "1794901882456070" });
    expect(log[0]!.eq).toEqual([
      ["user_id", "u1"],
      ["rev", "1794901882456066"],
    ]);
    expect(log[0]!.columns).toBe("updated_at, rev");
  });

  it("ohne bekannte Revision wird auch bei useRev auf den exakten updated_at gefiltert (nie ohne Bedingung)", async () => {
    const { table, log } = recordingTable(() => REV_OK(5));
    await casWrite({ ...base, table, observedToken: OBSERVED, observedRev: null, useRev: true });
    expect(log[0]!.eq).toEqual([
      ["user_id", "u1"],
      ["updated_at", OBSERVED],
    ]);
  });

  it("Standard (useRev=false): unverändertes Verhalten, nur updated_at", async () => {
    const { table, log } = recordingTable(() => ok("2026-11-17T10:00:00+00:00"));
    const out = await casWrite({ ...base, table, observedToken: OBSERVED });
    expect(out).toMatchObject({ kind: "written", rev: null });
    expect(log[0]!.columns).toBe("updated_at");
  });

  it("Null Zeilen → stale; mehr als eine → ambiguous – auch mit rev", async () => {
    const zero = recordingTable(() => ({ data: [], error: null }));
    expect(
      await casWrite({
        ...base,
        table: zero.table,
        observedToken: OBSERVED,
        observedRev: "9",
        useRev: true,
      }),
    ).toEqual({
      kind: "stale",
      reason: "zero-rows",
    });
    const two = recordingTable(() => ({
      data: [
        { updated_at: "a", rev: 1 },
        { updated_at: "b", rev: 2 },
      ],
      error: null,
    }));
    expect(
      (
        await casWrite({
          ...base,
          table: two.table,
          observedToken: OBSERVED,
          observedRev: "9",
          useRev: true,
        })
      ).kind,
    ).toBe("ambiguous");
  });

  it("Insert fragt rev an", async () => {
    const { table, log } = recordingTable(() => REV_OK(7));
    const out = await casWrite({ ...base, table, observedToken: null, useRev: true });
    expect(out).toMatchObject({ kind: "written", mode: "insert", rev: "7" });
    expect(log[0]!.columns).toBe("updated_at, rev");
  });

  it.each([
    [{ code: "42703", message: "column backups.rev does not exist" }],
    [{ code: "42703", message: 'column "rev" does not exist' }],
    [
      {
        code: "PGRST204",
        message: "Could not find the 'rev' column of 'backups' in the schema cache",
      },
    ],
  ])(
    "bestätigter Fehler 'Spalte rev fehlt' (%j) → rev-unsupported (Update und Insert)",
    async (error) => {
      const upd = recordingTable(() => ({ data: null, error }));
      expect(
        await casWrite({
          ...base,
          table: upd.table,
          observedToken: OBSERVED,
          observedRev: "9",
          useRev: true,
        }),
      ).toEqual({
        kind: "rev-unsupported",
      });
      const ins = recordingTable(() => ({ data: null, error }));
      expect(
        await casWrite({ ...base, table: ins.table, observedToken: null, useRev: true }),
      ).toEqual({
        kind: "rev-unsupported",
      });
    },
  );

  it.each([
    [{ code: "42703", message: "column backups.payload2 does not exist" }],
    [{ code: "42703", message: "column backups.reverse does not exist" }],
    [{ code: "42703", message: "" }],
    [{ code: "42501", message: "permission denied for column rev" }],
    [{ code: "PGRST204", message: "Could not find the 'other' column" }],
    [{ code: "PGRST116", message: "rev" }],
    [{ message: "column rev does not exist" }],
  ])("jeder andere Fehler (%j) ist KEIN Rückfallsignal", async (error) => {
    expect(isMissingRevColumnError(error)).toBe(false);
    const { table } = recordingTable(() => ({ data: null, error }));
    const out = await casWrite({
      ...base,
      table,
      observedToken: OBSERVED,
      observedRev: "9",
      useRev: true,
    });
    expect(out.kind).not.toBe("rev-unsupported");
  });

  it("ohne useRev wird auch ein rev-Fehler nicht als Rückfall gedeutet", async () => {
    const { table } = recordingTable(() => ({
      data: null,
      error: { code: "42703", message: "column backups.rev does not exist" },
    }));
    const out = await casWrite({ ...base, table, observedToken: OBSERVED });
    expect(out).toEqual({ kind: "error", code: "42703" });
  });

  it("parseRev: nur exakt darstellbare positive ganze Zahlen; sonst null (nie gerundet)", () => {
    expect(parseRev(1794901882456066)).toBe("1794901882456066");
    expect(parseRev("1794901882456066")).toBe("1794901882456066");
    expect(parseRev(9007199254740991)).toBe("9007199254740991");
    expect(parseRev(2 ** 53 + 2)).toBeNull(); // über 2^53: bereits gerundet
    expect(parseRev(0)).toBeNull();
    expect(parseRev(-3)).toBeNull();
    expect(parseRev(1.5)).toBeNull();
    expect(parseRev("12ab")).toBeNull();
    expect(parseRev(null)).toBeNull();
    expect(parseRev(undefined)).toBeNull();
  });

  const pending: PendingWrite = {
    observedToken: OBSERVED,
    observedRev: "100",
    attemptedToken: "2026-11-17T10:00:00.000Z",
    fingerprint: "fp",
    at: 1,
  };
  it("unklares Ergebnis: Revision unverändert → nicht angekommen; jede andere Revision → Konflikt (auch bei gleichem Token)", () => {
    expect(resolvePendingWrite(pending, { token: OBSERVED, fingerprint: "x", rev: "100" })).toBe(
      "not-landed",
    );
    expect(resolvePendingWrite(pending, { token: OBSERVED, fingerprint: "x", rev: "101" })).toBe(
      "conflict",
    );
    expect(
      resolvePendingWrite(pending, { token: "2026-12-01T00:00:00Z", fingerprint: "x", rev: "100" }),
    ).toBe("not-landed");
  });
  it("Token + Inhalt gleich → übernehmen, unabhängig von der Revision", () => {
    expect(
      resolvePendingWrite(pending, {
        token: "2026-11-17T10:00:00+00:00",
        fingerprint: "fp",
        rev: "105",
      }),
    ).toBe("adopt");
  });
  it("ohne bekannte Revision gilt weiter die Token-Regel", () => {
    expect(
      resolvePendingWrite(
        { ...pending, observedRev: null },
        { token: OBSERVED, fingerprint: "x", rev: "100" },
      ),
    ).toBe("not-landed");
  });
});
