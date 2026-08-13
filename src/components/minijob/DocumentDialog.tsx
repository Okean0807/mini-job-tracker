import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/lib/i18n";
import {
  DOC_CATEGORIES,
  parseTags,
  updateDocument,
  type DocumentRow,
  type FolderRow,
} from "@/lib/minijob/documents";
import type { Job } from "@/lib/minijob/types";

interface Props {
  doc: DocumentRow | null;
  folders: FolderRow[];
  jobs: Job[];
  onClose: () => void;
  onSaved: () => void;
}

export function DocumentDialog({ doc, folders, jobs, onClose, onSaved }: Props) {
  const { t } = useT();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("sonstiges");
  const [jobId, setJobId] = useState("none");
  const [folderId, setFolderId] = useState("none");
  const [tags, setTags] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!doc) return;
    setName(doc.name);
    setCategory(doc.category);
    setJobId(doc.job_id ?? "none");
    setFolderId(doc.folder_id ?? "none");
    setTags((doc.tags ?? []).join(", "));
    setNote(doc.note ?? "");
  }, [doc]);

  async function handleSave() {
    if (!doc) return;
    setBusy(true);
    try {
      await updateDocument(doc.id, {
        name: name.trim() || doc.name,
        category,
        job_id: jobId === "none" ? null : jobId,
        folder_id: folderId === "none" ? null : folderId,
        tags: parseTags(tags),
        note: note.trim() || null,
      });
      toast.success(t("doc.saveOk"));
      onSaved();
      onClose();
    } catch {
      toast.error(t("doc.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!doc} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("doc.editTitle")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="ed-name">{t("doc.file")}</Label>
            <Input id="ed-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t("doc.category")}</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DOC_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {t(`doc.cat.${c}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("doc.folder")}</Label>
              <Select value={folderId} onValueChange={setFolderId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("doc.noFolder")}</SelectItem>
                  {folders.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>{t("doc.job")}</Label>
            <Select value={jobId} onValueChange={setJobId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("doc.noJob")}</SelectItem>
                {jobs.map((j) => (
                  <SelectItem key={j.id} value={j.id}>
                    {j.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ed-tags">{t("doc.tags")}</Label>
            <Input
              id="ed-tags"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder={t("doc.tagsHint")}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ed-note">{t("doc.note")}</Label>
            <Textarea
              id="ed-note"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("doc.cancel")}
          </Button>
          <Button onClick={() => void handleSave()} disabled={busy}>
            {t("doc.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
