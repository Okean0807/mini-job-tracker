import { Fragment, useSyncExternalStore, type ReactNode } from "react";

import { scopeSuffix } from "@/lib/minijob/storage-scope";
import { getActiveScope, onScopeChange } from "@/lib/minijob/store";

/** Schlüssel des aktiven Namensraums (Konto / Testmodus / Gast), reaktiv. */
export function useActiveScopeKey(): string {
  return useSyncExternalStore(
    (listener) => onScopeChange(() => listener()),
    () => scopeSuffix(getActiveScope()),
    () => "guest",
  );
}

/**
 * Mountet den Inhalt (Seiten samt offener Dialoge: Schicht, Job, Auftrag …) bei
 * jedem Konto-/Scope-Wechsel neu. Lokaler State (Formulareingaben) wird dabei
 * verworfen und kann nie in den neuen Namensraum gespeichert werden.
 */
export function ScopeBoundary({ children }: { children: ReactNode }) {
  const scope = useActiveScopeKey();
  return <Fragment key={scope}>{children}</Fragment>;
}
