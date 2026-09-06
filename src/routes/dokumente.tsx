import { createFileRoute } from "@tanstack/react-router";
import type { Session } from "@supabase/supabase-js";
import { FileText, FolderPlus, Pencil, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { DocumentDialog } from "@/components/minijob/DocumentDialog";
import { FolderDialog } from "@/components/minijob/FolderDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useT } from "@/lib/i18n";
import { formatDate } from "@/lib/minijob/calc";
import {
  DOC_CATEGORIES,
  deleteDocument,
  documentUrl,
  formatSize,
  listDocuments,
  listFolders,
  parseTags,
  uploadDocument,
  type DocumentRow,
  type FolderRow,
} from "@/lib/minijob/documents";
import { useAppData } from "@/lib/minijob/store";

export const Route = createFileRoute("/dokumente")({
  head: () => ({
    meta: [
      { title: "Dokumente – MiniJob Tracker" },
      {
        name: "description",
        content:
          "Arbeitsverträge, Lohnabrechnungen und Bescheinigungen als PDF sicher speichern, nach Sammlung, Schlagwort und Job sortiert.",
      },
      { property: "og:title", content: "Dokumente – MiniJob Tracker" },
      {
        property: "og:description",
        content: "Verträge, Lohnabrechnungen und Bescheinigungen sicher in der Cloud verwalten.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DocumentsPage,
});

const MAX_SIZE = 20 * 1024 * 1024;

function DocumentsPage() {
  const { t } = useT();
  const { jobs } = useAppData();
  const [session, setSession] = useState<Session | null>(null);
  const [docs, setDocs] = useState<DocumentRow[]>([]);
  const [folders, setFolders] = useState<FolderRow[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState<string>("vertrag");
  const [jobId, setJobId] = useState<string>("none");
  const [folderId, setFolderId] = useState<string>("none");
  const [tags, setTags] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const [search, setSearch] = useState("");
  const [filterFolder, setFilterFolder] = useState<string>("all");
  const [filterTag, setFilterTag] = useState<string>("all");
  const [editDoc, setEditDoc] = useState<DocumentRow | null>(null);
  const [folderDialog, setFolderDialog] = useState(false);

  useEffect(() => {
    try {
      void supabase.auth
        .getSession()
        .then(({ data }) => setSession(data.session))
        .catch((error) => {
          console.error("[dokumente] getSession failed", error);
          setSession(null);
        });
      const { data: sub } = supabase.auth.onAuthStateChange((_e, next) => setSession(next));
      return () => sub.subscription.unsubscribe();
    } catch (error) {
      // Missing Supabase env → treat as signed out (show doc.signedOut UI).
      console.error("[dokumente] Supabase auth unavailable", error);
      setSession(null);
      return undefined;
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [d, f] = await Promise.all([listDocuments(), listFolders()]);
      setDocs(d);
      setFolders(f);
    } catch {
      /* ohne Anmeldung keine Liste */
    }
  }, []);

  useEffect(() => {
    if (session) void refresh();
    else {
      setDocs([]);
      setFolders([]);
    }
  }, [session, refresh]);

  const allTags = useMemo(
    () => Array.from(new Set(docs.flatMap((d) => d.tags ?? []))).sort(),
    [docs],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return docs.filter((d) => {
      if (filterFolder === "none" && d.folder_id !== null) return false;
      if (filterFolder !== "all" && filterFolder !== "none" && d.folder_id !== filterFolder)
        return false;
      if (filterTag !== "all" && !(d.tags ?? []).includes(filterTag)) return false;
      if (!q) return true;
      return (
        d.name.toLowerCase().includes(q) ||
        (d.note ?? "").toLowerCase().includes(q) ||
        (d.tags ?? []).some((tag) => tag.toLowerCase().includes(q))
      );
    });
  }, [docs, search, filterFolder, filterTag]);

  async function handleUpload() {
    if (!file) {
      toast.error(t("doc.pickFile"));
      return;
    }
    if (file.size > MAX_SIZE) {
      toast.error(t("doc.tooLarge"));
      return;
    }
    setBusy(true);
    try {
      await uploadDocument(file, {
        category,
        ...(jobId !== "none" ? { jobId } : {}),
        ...(folderId !== "none" ? { folderId } : {}),
        tags: parseTags(tags),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      setFile(null);
      setNote("");
      setTags("");
      toast.success(t("doc.uploadOk"));
      await refresh();
    } catch {
      toast.error(t("doc.error"));
    } finally {
      setBusy(false);
    }
  }

  async function handleOpen(doc: DocumentRow) {
    try {
      window.open(await documentUrl(doc.path), "_blank", "noopener");
    } catch {
      toast.error(t("doc.error"));
    }
  }

  async function handleDelete(doc: DocumentRow) {
    try {
      await deleteDocument(doc);
      toast.success(t("doc.deleteOk"));
      await refresh();
    } catch {
      toast.error(t("doc.error"));
    }
  }

  return (
    <main className="mx-auto max-w-lg px-4 pt-6">
      <h1 className="text-2xl font-extrabold tracking-tight">{t("doc.pageTitle")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("doc.subtitle")}</p>

      {!session ? (
        <div className="mt-6 rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          {t("doc.signedOut")}
        </div>
      ) : (
        <>
          <section className="mt-5 space-y-3 rounded-2xl border bg-card p-4">
            <div className="space-y-1.5">
              <Label htmlFor="doc-file">{t("doc.file")}</Label>
              <Input
                id="doc-file"
                type="file"
                accept="application/pdf,image/*"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
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
            </div>

            <div className="space-y-1.5">
              <Label>{t("doc.folder")}</Label>
              <div className="flex gap-2">
                <Select value={folderId} onValueChange={setFolderId}>
                  <SelectTrigger className="flex-1">
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
                <Button
                  variant="outline"
                  size="icon"
                  aria-label={t("doc.manageFolders")}
                  onClick={() => setFolderDialog(true)}
                >
                  <FolderPlus className="size-4" />
                </Button>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="doc-tags">{t("doc.tags")}</Label>
              <Input
                id="doc-tags"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder={t("doc.tagsHint")}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="doc-note">{t("doc.note")}</Label>
              <Input id="doc-note" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>

            <Button className="w-full" onClick={() => void handleUpload()} disabled={busy}>
              <Upload className="mr-2 size-4" />
              {busy ? t("doc.uploading") : t("doc.upload")}
            </Button>
          </section>

          <section className="mt-5 space-y-3">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("doc.search")}
              aria-label={t("doc.search")}
            />
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
              {[
                { id: "all", name: t("doc.allFolders"), color: "" },
                ...folders,
                { id: "none", name: t("doc.noFolder"), color: "" },
              ].map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFilterFolder(f.id)}
                  className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold ${
                    filterFolder === f.id ? "bg-primary text-primary-foreground" : "bg-card"
                  }`}
                >
                  {f.color ? (
                    <span className="size-2 rounded-full" style={{ backgroundColor: f.color }} />
                  ) : null}
                  {f.name}
                </button>
              ))}
            </div>
            {allTags.length > 0 ? (
              <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
                {["all", ...allTags].map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => setFilterTag(tag)}
                    className={`shrink-0 rounded-full border px-3 py-1 text-xs ${
                      filterTag === tag ? "border-primary text-primary" : "text-muted-foreground"
                    }`}
                  >
                    {tag === "all" ? t("doc.allTags") : `#${tag}`}
                  </button>
                ))}
              </div>
            ) : null}
          </section>

          <section className="mt-3 space-y-2 pb-4">
            {docs.length === 0 ? (
              <div className="rounded-2xl border border-dashed p-8 text-center">
                <FileText className="mx-auto size-8 text-muted-foreground" />
                <p className="mt-3 text-sm text-muted-foreground">{t("doc.empty")}</p>
              </div>
            ) : visible.length === 0 ? (
              <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                {t("doc.noResults")}
              </div>
            ) : (
              visible.map((doc) => {
                const job = jobs.find((j) => j.id === doc.job_id);
                const folder = folders.find((f) => f.id === doc.folder_id);
                return (
                  <div key={doc.id} className="rounded-2xl border bg-card p-3">
                    <div className="flex items-center gap-3">
                      <FileText className="size-5 shrink-0 text-primary" />
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        onClick={() => void handleOpen(doc)}
                      >
                        <p className="truncate text-sm font-semibold">{doc.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {t(`doc.cat.${doc.category}`)} · {formatSize(doc.size)} ·{" "}
                          {formatDate(doc.created_at.slice(0, 10))}
                          {job ? ` · ${job.name}` : ""}
                        </p>
                      </button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t("doc.edit")}
                        onClick={() => setEditDoc(doc)}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t("doc.delete")}
                        onClick={() => void handleDelete(doc)}
                      >
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </div>

                    {folder || (doc.tags ?? []).length > 0 || doc.note ? (
                      <div className="mt-2 space-y-1.5 pl-8">
                        <div className="flex flex-wrap gap-1.5">
                          {folder ? (
                            <span
                              className="flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold"
                              style={{ borderColor: folder.color, color: folder.color }}
                            >
                              {folder.name}
                            </span>
                          ) : null}
                          {(doc.tags ?? []).map((tag) => (
                            <span
                              key={tag}
                              className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
                            >
                              #{tag}
                            </span>
                          ))}
                        </div>
                        {doc.note ? (
                          <p className="text-xs text-muted-foreground">{doc.note}</p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </section>

          <DocumentDialog
            doc={editDoc}
            folders={folders}
            jobs={jobs}
            onClose={() => setEditDoc(null)}
            onSaved={() => void refresh()}
          />
          <FolderDialog
            open={folderDialog}
            folders={folders}
            onClose={() => setFolderDialog(false)}
            onChanged={() => void refresh()}
          />
        </>
      )}
    </main>
  );
}
