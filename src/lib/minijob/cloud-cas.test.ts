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
