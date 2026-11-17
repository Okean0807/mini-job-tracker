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

/**
 * Optionale Serverrevision (Stage 1). Ohne `rev`-Hook verhält sich das Double wie zuvor (kein `rev`).
 * Mit Hook: `enabled() === true` = neues Schema (Sequenz + Trigger: jede Schreibung vergibt eine neue,
 * größere Revision), `false` = altes Schema (jede Anfrage, die `rev` nennt, scheitert mit 42703 und
 * schreibt NICHTS – wie PostgreSQL bei einer fehlenden Spalte).
 */
export interface RevHooks {
  enabled(): boolean;
  /** Aktuelle Revision der Zeile (Zahl; Test verwaltet den Zähler). */
  get(userId: string): number | undefined;
  /** Vergibt die nächste Revision und speichert sie (wie der Trigger). */
  next(userId: string): number;
}

export const MISSING_REV_ERROR = { code: "42703", message: "column backups.rev does not exist" };

export interface BackupsDoubleHooks {
  /** Stage 1: serverseitige Revision simulieren. */
  rev?: RevHooks;
  /** Jeder Schreibzugriff meldet hier Art, Konto und die verwendete Filterspalte. */
  onFilter?(info: { kind: "insert" | "update"; filter: "rev" | "updated_at" | "none" }): void;
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
    select: (columns: string = "") => ({
      eq: (_col: string, uid: string) => ({
        maybeSingle: async () => {
          const injected = await h.onSelect?.(uid);
          if (injected && injected.error) return { data: null, error: injected.error };
          const row = h.read(uid);
          if (h.rev && columns.includes("rev")) {
            if (!h.rev.enabled()) return { data: null, error: MISSING_REV_ERROR };
            const rev = h.rev.get(uid ?? "");
            return { data: row ? { ...row, rev } : null, error: null };
          }
          return { data: row, error: null };
        },
      }),
    }),
    insert: (row: { user_id: string; payload: unknown; updated_at: string }) => ({
      select: async (columns: string = "") => {
        h.onFilter?.({ kind: "insert", filter: "none" });
        if (h.rev && columns.includes("rev") && !h.rev.enabled()) {
          return { data: null, error: MISSING_REV_ERROR };
        }
        const injected = await h.onWrite?.("insert", row.user_id);
        if (injected && injected.error) return { data: null, error: injected.error };
        if (h.read(row.user_id)) {
          return { data: null, error: { code: "23505", message: "duplicate key" } };
        }
        h.write(row.user_id, { payload: row.payload, updated_at: row.updated_at }, "insert");
        const rev = h.rev?.enabled() ? h.rev.next(row.user_id) : undefined;
        return {
          data: [{ updated_at: row.updated_at, ...(columns.includes("rev") ? { rev } : {}) }],
          error: null,
        };
      },
    }),
    update: (row: { payload: unknown; updated_at: string }) => ({
      eq: (_c1: string, uid: string) => ({
        eq: (c2: string, observed: string) => ({
          select: async (columns: string = "") => {
            h.onFilter?.({ kind: "update", filter: c2 === "rev" ? "rev" : "updated_at" });
            // Altes Schema: eine Anfrage, die `rev` nennt (Filter oder RETURNING), scheitert als
            // Ganzes und schreibt nichts.
            if (h.rev && !h.rev.enabled() && (c2 === "rev" || columns.includes("rev"))) {
              return { data: null, error: MISSING_REV_ERROR };
            }
            const injected = await h.onWrite?.("update", uid);
            if (injected && injected.error) return { data: null, error: injected.error };
            const current = h.read(uid);
            const matches =
              c2 === "rev"
                ? !!current && String(h.rev?.get(uid)) === observed
                : !!current && current.updated_at === observed;
            if (!matches) return { data: [], error: null };
            h.write(uid, { payload: row.payload, updated_at: row.updated_at }, "update");
            const rev = h.rev?.enabled() ? h.rev.next(uid) : undefined;
            return {
              data: [{ updated_at: row.updated_at, ...(columns.includes("rev") ? { rev } : {}) }],
              error: null,
            };
          },
        }),
      }),
    }),
  };
}
