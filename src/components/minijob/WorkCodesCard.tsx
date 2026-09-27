import { ClipboardList, Plus } from "lucide-react";
import { useState } from "react";

import { WorkCodeDialog } from "@/components/minijob/WorkCodeDialog";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";
import type { WorkCodeDef } from "@/lib/minijob/types";

export function WorkCodesCard({ workCodes }: { workCodes: WorkCodeDef[] }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<WorkCodeDef | null>(null);

  function openNew() {
    setEditing(null);
    setOpen(true);
  }

  function openEdit(item: WorkCodeDef) {
    setEditing(item);
    setOpen(true);
  }

  return (
    <section
      className="rounded-2xl border bg-card p-4 shadow-card"
      aria-label={t("worklog.myWorkCodes")}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t("worklog.myWorkCodes")}
        </span>
        <ClipboardList className="size-4 text-muted-foreground" />
      </div>

      {workCodes.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{t("worklog.myWorkCodesEmpty")}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {workCodes.map((item) => (
            <li key={item.code}>
              <button
                type="button"
                onClick={() => openEdit(item)}
                className="w-full rounded-xl border bg-background px-3 py-2 text-left hover:bg-muted/50"
              >
                <p className="truncate text-sm font-medium">
                  {item.code} · {item.label}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}

      <Button type="button" variant="outline" size="sm" className="mt-3 w-full" onClick={openNew}>
        <Plus className="size-4" /> {t("worklog.newWorkCode")}
      </Button>

      <WorkCodeDialog open={open} onOpenChange={setOpen} item={editing} />
    </section>
  );
}
