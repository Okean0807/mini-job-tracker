/**
 * Test-Double für `supabase.from("backups")` mit den Semantiken, die die App nach Phase 4
 * verwendet: select/insert/update (bedingt, `.eq().eq().select()`). `upsert` ist VERBOTEN und
 * wirft – jede App-Stelle, die noch blind schreibt, fällt sofort auf.
 *
 * ACHTUNG: Das ist ein Double, kein PostgREST. Das echte Verhalten ist damit nicht bewiesen.
 */
export interface BackupsRow {
  payload: unknown;
  updated_at: string;
}

export interface BackupsDoubleHooks {
  /** Aktuelle Zeile (für `userId`, falls das Double mehrere Konten hält). */
  read(userId: string | undefined): BackupsRow | null;
  /** Erfolgreich geschriebene Zeile ablegen. */
  write(userId: string, row: BackupsRow, kind: "insert" | "update"): void;
  /** Vor jedem Schreibzugriff (Gate/Zählen); ein Rückgabewert mit `error` simuliert Fehler. */
  onWrite?(kind: "insert" | "update", userId: string): Promise<{ error: unknown } | null | void>;
  /** Vor jedem Lesezugriff; `error` simuliert einen Lesefehler. */
  onSelect?(userId: string | undefined): Promise<{ error: unknown } | null | void>;
  /** Wird bei jedem (verbotenen) `upsert` aufgerufen. */
  onUpsert?(): void;
}

export function makeBackupsTable(h: BackupsDoubleHooks) {
  return {
    upsert: () => {
      h.onUpsert?.();
      throw new Error("blind upsert is forbidden (Phase 4: CAS only)");
    },
    select: () => ({
      eq: (_col: string, uid: string) => ({
        maybeSingle: async () => {
          const injected = await h.onSelect?.(uid);
          if (injected && injected.error) return { data: null, error: injected.error };
          return { data: h.read(uid), error: null };
        },
      }),
    }),
    insert: (row: { user_id: string; payload: unknown; updated_at: string }) => ({
      select: async () => {
        const injected = await h.onWrite?.("insert", row.user_id);
        if (injected && injected.error) return { data: null, error: injected.error };
        if (h.read(row.user_id)) {
          return { data: null, error: { code: "23505", message: "duplicate key" } };
        }
        h.write(row.user_id, { payload: row.payload, updated_at: row.updated_at }, "insert");
        return { data: [{ updated_at: row.updated_at }], error: null };
      },
    }),
    update: (row: { payload: unknown; updated_at: string }) => ({
      eq: (_c1: string, uid: string) => ({
        eq: (_c2: string, observed: string) => ({
          select: async () => {
            const injected = await h.onWrite?.("update", uid);
            if (injected && injected.error) return { data: null, error: injected.error };
            const current = h.read(uid);
            if (!current || current.updated_at !== observed) return { data: [], error: null };
            h.write(uid, { payload: row.payload, updated_at: row.updated_at }, "update");
            return { data: [{ updated_at: row.updated_at }], error: null };
          },
        }),
      }),
    }),
  };
}
