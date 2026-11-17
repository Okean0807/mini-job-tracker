/**
 * Phase 5 – WIE das echte `@supabase/postgrest-js` die CAS-Anfragen der App auf HTTP abbildet.
 *
 * Das beweist die CLIENT-Seite des Vertrags (Methode, Query, Kodierung von `+`, Prefer-Header,
 * Antwort-Auswertung). Es beweist NICHT das Verhalten des PostgREST-Servers oder der Datenbank –
 * dafür gibt es `scripts/db-tests/cas_run.sh` (echte PostgreSQL-Instanz, lokal und isoliert).
 */
import { PostgrestClient } from "@supabase/postgrest-js";
import { describe, expect, it } from "vitest";

import { casWrite, nextToken, type BackupsTable } from "./cloud-cas";

interface Captured {
  method: string;
  url: URL;
  prefer: string | null;
  body: unknown;
}

function client(respond: (c: Captured) => { status: number; body: unknown }) {
  const calls: Captured[] = [];
  const pg = new PostgrestClient("http://rest.test/rest/v1", {
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const c: Captured = {
        method: String(init?.method ?? "GET"),
        url: new URL(String(input)),
        prefer: headers.get("prefer"),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      };
      calls.push(c);
      const { status, body } = respond(c);
      return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    },
  });
  return { table: pg.from("backups") as unknown as BackupsTable, calls };
}

const OBSERVED = "2026-10-27T19:28:52.738+00:00"; // exakt so liefert PostgREST timestamptz
const MICRO = "2026-10-27T19:28:52.738123+00:00"; // Schreiber mit Mikrosekunden (now())

describe("Update: Anfrage des echten postgrest-js", () => {
  it("PATCH mit user_id UND exaktem updated_at; '+' wird als %2B kodiert; Prefer: return=representation", async () => {
    const token = nextToken(OBSERVED, Date.parse(OBSERVED) + 5000);
    const { table, calls } = client(() => ({ status: 200, body: [{ updated_at: token }] }));
    const outcome = await casWrite({
      table,
      userId: "11111111-1111-1111-1111-111111111111",
      observedToken: OBSERVED,
      payload: { shifts: [] },
      token,
    });
    expect(outcome).toMatchObject({ kind: "written", mode: "update", token });
    expect(calls).toHaveLength(1);
    const c = calls[0]!;
    expect(c.method).toBe("PATCH");
    expect(c.url.pathname).toBe("/rest/v1/backups");
    // Rohe Query: das Pluszeichen der Zeitzone MUSS als %2B im Pfad stehen, sonst würde der
    // Server es als Leerzeichen lesen und der Vergleich nie treffen.
    expect(c.url.search).toContain("updated_at=eq.2026-10-27T19%3A28%3A52.738%2B00%3A00");
    expect(c.url.searchParams.get("updated_at")).toBe(`eq.${OBSERVED}`);
    expect(c.url.searchParams.get("user_id")).toBe("eq.11111111-1111-1111-1111-111111111111");
    expect(c.url.searchParams.get("select")).toBe("updated_at");
    expect(c.prefer).toContain("return=representation");
    expect(c.body).toEqual({ payload: { shifts: [] }, updated_at: token });
  });

  it("Mikrosekunden bleiben im Filter exakt erhalten (kein Kürzen auf Millisekunden)", async () => {
    const { table, calls } = client(() => ({ status: 200, body: [] }));
    await casWrite({
      table,
      userId: "u",
      observedToken: MICRO,
      payload: {},
      token: "2026-11-01T00:00:00.000Z",
    });
    expect(calls[0]!.url.searchParams.get("updated_at")).toBe(`eq.${MICRO}`);
  });

  it("leeres Array (0 Zeilen) → stale; ein Element → Erfolg; Server-Token wird übernommen", async () => {
    const zero = client(() => ({ status: 200, body: [] }));
    expect(
      await casWrite({
        table: zero.table,
        userId: "u",
        observedToken: OBSERVED,
        payload: {},
        token: "t",
      }),
    ).toEqual({
      kind: "stale",
      reason: "zero-rows",
    });
    const one = client(() => ({
      status: 200,
      body: [{ updated_at: "2026-11-17T10:00:00.123456+00:00" }],
    }));
    expect(
      await casWrite({
        table: one.table,
        userId: "u",
        observedToken: OBSERVED,
        payload: {},
        token: "t",
      }),
    ).toMatchObject({ kind: "written", token: "2026-11-17T10:00:00.123456+00:00" });
  });
});

describe("Insert: Anfrage des echten postgrest-js", () => {
  it("POST (kein PATCH/Upsert), kein on_conflict, Prefer: return=representation", async () => {
    const { table, calls } = client(() => ({
      status: 201,
      body: [{ updated_at: "2026-11-17T10:00:00+00:00" }],
    }));
    const outcome = await casWrite({
      table,
      userId: "u1",
      observedToken: null,
      payload: { a: 1 },
      token: "2026-11-17T10:00:00.000Z",
    });
    expect(outcome).toMatchObject({ kind: "written", mode: "insert" });
    const c = calls[0]!;
    expect(c.method).toBe("POST");
    expect(c.url.searchParams.has("on_conflict")).toBe(false);
    expect(c.prefer).toContain("return=representation");
    expect(c.prefer ?? "").not.toContain("resolution=merge-duplicates");
    expect(c.body).toEqual({
      user_id: "u1",
      payload: { a: 1 },
      updated_at: "2026-11-17T10:00:00.000Z",
    });
  });
});

describe("Fehlerantworten (PostgREST-Format) → Ergebnisklassen", () => {
  const err = (status: number, code: string) =>
    client(() => ({ status, body: { code, message: "m", details: null, hint: null } }));

  it.each([
    [409, "23505", { kind: "stale", reason: "unique-violation" }],
    [409, "23503", { kind: "account-gone" }],
    [403, "42501", { kind: "forbidden" }],
    [401, "PGRST301", { kind: "forbidden" }],
  ] as const)("HTTP %s %s", async (status, code, expected) => {
    const { table } = err(status, code);
    const outcome = await casWrite({
      table,
      userId: "u",
      observedToken: null,
      payload: {},
      token: "t",
    });
    expect(outcome).toEqual(expected);
  });

  it("Netzwerkfehler des echten Clients (fetch wirft) → ambiguous", async () => {
    const pg = new PostgrestClient("http://rest.test/rest/v1", {
      fetch: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    const outcome = await casWrite({
      table: pg.from("backups") as unknown as BackupsTable,
      userId: "u",
      observedToken: OBSERVED,
      payload: {},
      token: "t",
    });
    expect(outcome.kind).toBe("ambiguous");
  });
});

describe("Stage 1: Revision über den echten postgrest-js", () => {
  it("PATCH filtert auf user_id + rev=eq.<exakt>, selektiert updated_at,rev; kein updated_at-Filter", async () => {
    const { table, calls } = client(() => ({
      status: 200,
      body: [{ updated_at: "2026-11-17T10:00:00+00:00", rev: 1794901882456070 }],
    }));
    const outcome = await casWrite({
      table,
      userId: "11111111-1111-1111-1111-111111111111",
      observedToken: OBSERVED,
      observedRev: "1794901882456066",
      payload: { a: 1 },
      token: "2026-11-17T10:00:00.000Z",
      useRev: true,
    });
    expect(outcome).toMatchObject({ kind: "written", mode: "update", rev: "1794901882456070" });
    const c = calls[0]!;
    expect(c.method).toBe("PATCH");
    expect(c.url.searchParams.get("rev")).toBe("eq.1794901882456066");
    expect(c.url.searchParams.has("updated_at")).toBe(false);
    expect(c.url.searchParams.get("select")).toBe("updated_at,rev");
    expect(c.prefer).toContain("return=representation");
    // Der Client sendet KEINE Revision im Body (der Server vergibt sie) und keinen Sonder-Header.
    expect(c.body).toEqual({ payload: { a: 1 }, updated_at: "2026-11-17T10:00:00.000Z" });
  });

  it("fehlende Spalte: PostgREST-Fehlerformat (42703) → rev-unsupported; ein anderer Fehler → nicht", async () => {
    const missing = client(() => ({
      status: 400,
      body: {
        code: "42703",
        message: "column backups.rev does not exist",
        details: null,
        hint: null,
      },
    }));
    expect(
      await casWrite({
        table: missing.table,
        userId: "u",
        observedToken: OBSERVED,
        observedRev: "9",
        payload: {},
        token: "t",
        useRev: true,
      }),
    ).toEqual({ kind: "rev-unsupported" });
    const other = client(() => ({
      status: 400,
      body: {
        code: "42703",
        message: "column backups.nope does not exist",
        details: null,
        hint: null,
      },
    }));
    expect(
      (
        await casWrite({
          table: other.table,
          userId: "u",
          observedToken: OBSERVED,
          observedRev: "9",
          payload: {},
          token: "t",
          useRev: true,
        })
      ).kind,
    ).toBe("error");
  });

  it("Insert: POST ohne on_conflict, selektiert updated_at,rev", async () => {
    const { table, calls } = client(() => ({
      status: 201,
      body: [{ updated_at: "2026-11-17T10:00:00+00:00", rev: 7 }],
    }));
    await casWrite({
      table,
      userId: "u1",
      observedToken: null,
      payload: {},
      token: "2026-11-17T10:00:00.000Z",
      useRev: true,
    });
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.url.searchParams.has("on_conflict")).toBe(false);
    expect(calls[0]!.url.searchParams.get("select")).toBe("updated_at,rev");
  });
});
