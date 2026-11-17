/**
 * Bestätigungs-Brücke zwischen dem Ablauf (`runGuardedOperation`) und der Oberfläche.
 *
 * Es gibt KEINE Standard-Zustimmung: Ist kein Dialog eingehängt (oder kein Test-Handler
 * gesetzt), gilt die Operation als nicht bestätigt.
 */
import type { GuardedPreview } from "./guarded-operation";

export interface PendingConfirmation {
  preview: GuardedPreview;
  resolve: (confirmed: boolean) => void;
}

type Handler = (preview: GuardedPreview) => Promise<boolean>;

let handler: Handler | null = null;
let mounted = 0;
let pending: PendingConfirmation | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function subscribeConfirmation(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPendingConfirmation(): PendingConfirmation | null {
  return pending;
}

/** Der Dialog meldet sich an/ab; ohne Dialog wird nie "automatisch" bestätigt. */
export function registerConfirmationUi(): () => void {
  mounted += 1;
  return () => {
    mounted = Math.max(0, mounted - 1);
    if (mounted === 0 && pending) {
      const p = pending;
      pending = null;
      p.resolve(false);
      emit();
    }
  };
}

/** Nur für Tests: eigener Handler (`null` = zurücksetzen). */
export function setConfirmationHandlerForTests(next: Handler | null): void {
  handler = next;
}

export function requestConfirmation(preview: GuardedPreview): Promise<boolean> {
  if (handler) return handler(preview);
  if (mounted === 0) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    if (pending) pending.resolve(false); // nie zwei Bestätigungen gleichzeitig
    pending = {
      preview,
      resolve: (confirmed) => {
        if (pending && pending.preview === preview) pending = null;
        resolve(confirmed);
        emit();
      },
    };
    emit();
  });
}
