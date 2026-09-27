import { ClipboardList, Plus } from "lucide-react";
import { useState } from "react";

import { CustomTaskDialog } from "@/components/minijob/CustomTaskDialog";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";

export function CustomTasksCard({ tasks }: { tasks: string[] }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  function openNew() {
    setEditing(null);
    setOpen(true);
  }

  function openEdit(item: string) {
    setEditing(item);
    setOpen(true);
  }

  return (
    <section
      className="rounded-2xl border bg-card p-4 shadow-card"
      aria-label={t("worklog.myTasks")}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t("worklog.myTasks")}
        </span>
        <ClipboardList className="size-4 text-muted-foreground" />
      </div>

      {tasks.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{t("worklog.myTasksEmpty")}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {tasks.map((item) => (
            <li key={item}>
              <button
                type="button"
                onClick={() => openEdit(item)}
                className="w-full rounded-xl border bg-background px-3 py-2 text-left hover:bg-muted/50"
              >
                <p className="truncate text-sm font-medium">{item}</p>
              </button>
            </li>
          ))}
        </ul>
      )}

      <Button type="button" variant="outline" size="sm" className="mt-3 w-full" onClick={openNew}>
        <Plus className="size-4" /> {t("worklog.newTask")}
      </Button>

      <CustomTaskDialog open={open} onOpenChange={setOpen} item={editing} />
    </section>
  );
}
