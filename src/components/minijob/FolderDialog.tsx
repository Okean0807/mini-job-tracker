import { Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/lib/i18n";
import {
  FOLDER_COLORS,
  createFolder,
  deleteFolder,
  type FolderRow,
} from "@/lib/minijob/documents";

interface Props {
  open: boolean;
  folders: FolderRow[];
  onClose: () => void;
  onChanged: () => void;
}

export function FolderDialog({ open, folders, onClose, onChanged }: Props) {
  const { t } = useT();
  const [name, setName] = useState("");
  const [color, setColor] = useState(FOLDER_COLORS[0]!);
  const [busy, setBusy] = useState(false);

  async function handleCreate() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      await createFolder(trimmed, color);
      setName("");
      toast.success(t("doc.folderCreated"));
      onChanged();
    } catch {
      toast.error(t("doc.error"));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteFolder(id);
      toast.success(t("doc.folderDeleted"));
      onChanged();
    } catch {
      toast.error(t("doc.error"));
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("doc.manageFolders")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="fd-name">{t("doc.folderName")}</Label>
            <Input id="fd-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>{t("doc.folderColor")}</Label>
            <div className="flex flex-wrap gap-2">
              {FOLDER_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={c}
                  onClick={() => setColor(c)}
                  className={`size-8 rounded-full border-2 ${
                    color === c ? "border-foreground" : "border-transparent"
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
          <Button className="w-full" onClick={() => void handleCreate()} disabled={busy}>
            {t("doc.create")}
          </Button>
        </div>

        <div className="space-y-2">
          {folders.map((f) => (
            <div key={f.id} className="flex items-center gap-3 rounded-xl border p-2.5">
              <span className="size-3 rounded-full" style={{ backgroundColor: f.color }} />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{f.name}</span>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("doc.deleteFolder")}
                onClick={() => void handleDelete(f.id)}
              >
                <Trash2 className="size-4 text-destructive" />
              </Button>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
