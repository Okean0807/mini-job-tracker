import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEMO_SCOPE, userScope } from "./storage-scope";
import {
  DIAGNOSTIC_EVENTS,
  diagnosticsKey,
  readSyncDiagnostics,
  recordSyncEvent,
} from "./sync-diagnostics";

const A = userScope("user-a");
const B = userScope("user-b");

beforeEach(() => window.localStorage.clear());

describe("Sync-Diagnose: nur Zähler", () => {
  it("zählt je Ereignisart und Zeitpunkt, getrennt je Konto-Scope", () => {
    recordSyncEvent(A, "cas-stale", 1000);
    recordSyncEvent(A, "cas-stale", 2000);
    recordSyncEvent(A, "rev-fallback", 3000);
    recordSyncEvent(B, "cas-stale", 4000);
    const a = readSyncDiagnostics(A);
    expect(a.counts["cas-stale"]).toBe(2);
    expect(a.lastAt["cas-stale"]).toBe(2000);
    expect(a.counts["rev-fallback"]).toBe(1);
    expect(readSyncDiagnostics(B).counts["cas-stale"]).toBe(1);
    expect(readSyncDiagnostics(DEMO_SCOPE).counts["cas-stale"]).toBe(0);
    expect(diagnosticsKey(A)).not.toBe(diagnosticsKey(B));
  });

  it("speichert nur Zähler und Zeitstempel (keine Texte, keine Kennungen)", () => {
    recordSyncEvent(A, "remote-advanced-token-flat", 5);
    const raw = window.localStorage.getItem(diagnosticsKey(A))!;
    expect(Object.keys(JSON.parse(raw)).sort()).toEqual(["counts", "lastAt"]);
    expect(raw).not.toContain("user-a");
    for (const e of DIAGNOSTIC_EVENTS) expect(typeof JSON.parse(raw).counts[e]).toBe("number");
  });

  it("ist gedeckelt und übersteht beschädigte Daten und blockierten Speicher (wirft nie)", () => {
    window.localStorage.setItem(
      diagnosticsKey(A),
      JSON.stringify({ counts: { "cas-stale": 9e15, junk: 1 }, lastAt: "x" }),
    );
    recordSyncEvent(A, "cas-stale", 1);
    expect(readSyncDiagnostics(A).counts["cas-stale"]).toBeLessThanOrEqual(1_000_000);
    window.localStorage.setItem(diagnosticsKey(A), "{kaputt");
    expect(readSyncDiagnostics(A).counts["cas-stale"]).toBe(0);
    const spy = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    try {
      expect(() => recordSyncEvent(A, "ambiguous-write")).not.toThrow();
    } finally {
      spy.mockRestore();
    }
  });
});
