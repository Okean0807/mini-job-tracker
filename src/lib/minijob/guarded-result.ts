import type { AbortReason, GuardedResult } from "./guarded-operation";

export type GuardedFeedback =
  | { kind: "success"; unchanged: boolean }
  | { kind: "cancelled" }
  /** Konto/Scope hat gewechselt: still beenden (kein Fehler-Toast). */
  | { kind: "silent" }
  | { kind: "error"; key: string; text?: string };

const KEYS: Record<AbortReason, string> = {
  "lock-busy": "guarded.abort.lockBusy",
  "scope-changed": "guarded.abort.scopeChanged",
  "local-changed": "guarded.abort.localChanged",
  "remote-changed": "guarded.abort.remoteChanged",
  "invalid-payload": "guarded.abort.invalidPayload",
  "prepare-failed": "guarded.abort.prepareFailed",
  "remote-missing": "guarded.abort.remoteMissing",
  "snapshot-failed": "guarded.abort.snapshotFailed",
  "verification-failed": "guarded.abort.verificationFailed",
  "commit-failed": "guarded.abort.commitFailed",
};

/** Ergebnis → Rückmeldung. Fehlermeldungen kommen nur aus bekannten, datenfreien Fehlerklassen. */
export function guardedFeedback(result: GuardedResult): GuardedFeedback {
  if (result.status === "done") return { kind: "success", unchanged: result.unchanged };
  if (result.status === "cancelled") return { kind: "cancelled" };
  if (result.reason === "scope-changed") return { kind: "silent" };
  const known = result.error instanceof Error && /Error$/.test(result.error.name);
  const text =
    known &&
    ["CasStaleError", "CloudAccountGoneError", "CloudAuthError", "AmbiguousWriteError"].includes(
      (result.error as Error).name,
    )
      ? (result.error as Error).message
      : undefined;
  return text === undefined
    ? { kind: "error", key: KEYS[result.reason] }
    : { kind: "error", key: KEYS[result.reason], text };
}
