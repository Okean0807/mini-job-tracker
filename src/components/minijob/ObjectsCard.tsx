import { Building2, Plus } from "lucide-react";
import { useState } from "react";

import { ObjectDialog } from "@/components/minijob/ObjectDialog";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";
import { objectAddressPreview } from "@/lib/minijob/work-objects";
import type { WorkObject } from "@/lib/minijob/types";

export function ObjectsCard({ objects }: { objects: WorkObject[] }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<WorkObject | null>(null);

  function openNew() {
    setEditing(null);
    setOpen(true);
  }

  function openEdit(obj: WorkObject) {
    setEditing(obj);
    setOpen(true);
  }

  return (
    <section className="rounded-2xl border bg-card p-4 shadow-card" aria-label={t("object.title")}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t("object.title")}
        </span>
        <Building2 className="size-4 text-muted-foreground" />
      </div>

      {objects.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{t("object.empty")}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {objects.map((obj) => {
            const preview = objectAddressPreview(obj);
            return (
              <li key={obj.id}>
                <button
                  type="button"
                  onClick={() => openEdit(obj)}
                  className="w-full rounded-xl border bg-background px-3 py-2 text-left hover:bg-muted/50"
                >
                  <p className="truncate text-sm font-medium">{obj.name}</p>
                  {preview ? (
                    <p className="truncate text-xs text-muted-foreground">{preview}</p>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <Button type="button" variant="outline" size="sm" className="mt-3 w-full" onClick={openNew}>
        <Plus className="size-4" /> {t("object.new")}
      </Button>

      <ObjectDialog open={open} onOpenChange={setOpen} object={editing} />
    </section>
  );
}
