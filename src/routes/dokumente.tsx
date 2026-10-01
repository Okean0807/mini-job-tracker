import { createFileRoute } from "@tanstack/react-router";
import { Download, FileText, FolderPlus, Pencil, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuthSession } from "@/hooks/use-auth-session";
import { Skeleton } from "@/components/ui/skeleton";
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
import { useT } from "@/lib/i18n";
import { formatDate } from "@/lib/minijob/calc";
import {
  DOC_CATEGORIES,
  HUB_DOC_CATEGORIES,
  deleteDocument,
  documentCreatedDay,
  documentUrl,
  formatSize,
  listDocuments,
  listFolders,
  parseTags,
  uploadDocument,
  type DocumentRow,
  type FolderRow,
} from "@/lib/minijob/documents";
import {
  deleteGeneratedDocument,
  downloadGeneratedDocument,
  listGeneratedDocuments,
  openGeneratedDocument,
  type GeneratedDocument,
} from "@/lib/minijob/generated-docs";
import { onScopeChange, useAppData } from "@/lib/minijob/store";

export const Route = createFileRoute("/dokumente")({
  head: () => ({
    meta: [
      { title: "Dokumente – MiniJob Tracker" },
      {
        name: "description",
        content:
          "Arbeitsverträge, Lohnabrechnungen, Bescheinigungen und App-Exporte (PDF, Excel, Arbeitsnachweis) an einem Ort.",
      },
      { property: "og:title", content: "Dokumente – MiniJob Tracker" },
      {
        property: "og:description",
        content: "Uploads und App-Exporte sicher verwalten.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DocumentsPage,
});

const MAX_SIZE = 20 * 1024 * 1024;

type HubItem = { kind: "upload"; doc: DocumentRow } | { kind: "generated"; doc: GeneratedDocument };

function DocumentsPage() {
  const { t } = useT();
  const { jobs } = useAppData();
  const { status: authStatus, session } = useAuthSession();
  const [docs, setDocs] = useState<DocumentRow[]>([]);
  const [generated, setGenerated] = useState<GeneratedDocument[]>([]);
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
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [editDoc, setEditDoc] = useState<DocumentRow | null>(null);
  const [folderDialog, setFolderDialog] = useState(false);

  const refreshGenerated = useCallback(() => {
    setGenerated(listGeneratedDocuments());
  }, []);

  const refresh = useCallback(async () => {
    refreshGenerated();
    try {
      const [d, f] = await Promise.all([listDocuments(), listFolders()]);
      setDocs(d);
      setFolders(f);
    } catch {
      /* ohne Anmeldung keine Cloud-Liste */
    }
  }, [refreshGenerated]);

  useEffect(() => {
    refreshGenerated();
    // Nur Dokumente des aktiven Namensraums (Konto / Testmodus / Gast) zeigen –
    // bei Login/Logout/Kontowechsel sofort neu laden.
    return onScopeChange(() => refreshGenerated());
  }, [refreshGenerated]);

  useEffect(() => {
    if (authStatus === "signed_in" && session) void refresh();
    else if (authStatus === "signed_out") {
      setDocs([]);
      setFolders([]);
      refreshGenerated();
    }
  }, [authStatus, session, refresh, refreshGenerated]);

  const allTags = useMemo(
    () => Array.from(new Set(docs.flatMap((d) => d.tags ?? []))).sort(),
    [docs],
  );

  const hubItems = useMemo((): HubItem[] => {
    const uploads: HubItem[] = docs.map((doc) => ({ kind: "upload", doc }));
    const gens: HubItem[] = generated.map((doc) => ({ kind: "generated", doc }));
    return [...gens, ...uploads].sort((a, b) => {
      const aDay =
        a.kind === "upload"
          ? documentCreatedDay(a.doc.created_at) || a.doc.created_at || ""
          : a.doc.createdAt;
      const bDay =
        b.kind === "upload"
          ? documentCreatedDay(b.doc.created_at) || b.doc.created_at || ""
          : b.doc.createdAt;
      return aDay < bDay ? 1 : -1;
    });
  }, [docs, generated]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return hubItems.filter((item) => {
      if (item.kind === "upload") {
        const d = item.doc;
        if (filterFolder === "none" && d.folder_id !== null) return false;
        if (filterFolder !== "all" && filterFolder !== "none" && d.folder_id !== filterFolder)
          return false;
        if (filterTag !== "all" && !(d.tags ?? []).includes(filterTag)) return false;
        if (filterCategory !== "all" && d.category !== filterCategory) return false;
        if (!q) return true;
        return (
          d.name.toLowerCase().includes(q) ||
          (d.note ?? "").toLowerCase().includes(q) ||
          (d.tags ?? []).some((tag) => tag.toLowerCase().includes(q)) ||
          d.category.toLowerCase().includes(q)
        );
      }
      const d = item.doc;
      if (filterFolder !== "all" && filterFolder !== "none") return false;
      if (filterTag !== "all") return false;
      if (filterCategory !== "all" && d.category !== filterCategory) return false;
      if (!q) return true;
      return (
        d.name.toLowerCase().includes(q) ||
        d.category.toLowerCase().includes(q) ||
        t(`doc.cat.${d.category}`).toLowerCase().includes(q)
      );
    });
  }, [hubItems, search, filterFolder, filterTag, filterCategory, t]);

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

  async function handleOpenUpload(doc: DocumentRow) {
    try {
      window.open(await documentUrl(doc.path), "_blank", "noopener");
    } catch {
      toast.error(t("doc.error"));
    }
  }

  function handleOpenGenerated(doc: GeneratedDocument) {
    if (openGeneratedDocument(doc)) return;
    if (downloadGeneratedDocument(doc)) return;
    toast.error(t("doc.noPayload"));
  }

  function handleRedownload(doc: GeneratedDocument) {
    if (!downloadGeneratedDocument(doc)) toast.error(t("doc.noPayload"));
  }

  async function handleDeleteUpload(doc: DocumentRow) {
    try {
      await deleteDocument(doc);
      toast.success(t("doc.deleteOk"));
      await refresh();
    } catch {
      toast.error(t("doc.error"));
    }
  }

  function handleDeleteGenerated(doc: GeneratedDocument) {
    deleteGeneratedDocument(doc.id);
    toast.success(t("doc.deleteOk"));
    refreshGenerated();
  }

  const signedIn = authStatus === "signed_in";
  const hasAny = hubItems.length > 0;

  return (
    <main className="mx-auto max-w-lg px-4 pt-6">
      <h1 className="text-2xl font-extrabold tracking-tight">{t("doc.pageTitle")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("doc.subtitle")}</p>

      {authStatus === "loading" ? (
        <div
          className="mt-6 rounded-2xl border border-dashed p-8"
          aria-busy="true"
          aria-label="loading"
        >
          <Skeleton className="mx-auto h-4 w-56" />
          <Skeleton className="mx-auto mt-3 h-4 w-40" />
        </div>
      ) : (
        <>
          {authStatus === "signed_out" ? (
            <div className="mt-4 rounded-2xl border border-dashed p-4 text-center text-sm text-muted-foreground">
              {t("doc.signedOutUploads")}
            </div>
          ) : null}

          {signedIn ? (
            <section className="mt-5 space-y-3 rounded-2xl border bg-card p-4">
              <div className="space-y-1.5">
                <Label htmlFor="doc-file">{t("doc.file")}</Label>
                <Input
                  id="doc-file"
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,image/webp"
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
          ) : null}

          <section className="mt-5 space-y-3">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("doc.search")}
              aria-label={t("doc.search")}
            />
            <div className="space-y-1.5">
              <Label>{t("doc.filterCategory")}</Label>
              <Select value={filterCategory} onValueChange={setFilterCategory}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("doc.allCategories")}</SelectItem>
                  {HUB_DOC_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {t(`doc.cat.${c}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {signedIn ? (
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
            ) : null}
            {signedIn && allTags.length > 0 ? (
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
            {!hasAny ? (
              <div className="rounded-2xl border border-dashed p-8 text-center">
                <FileText className="mx-auto size-8 text-muted-foreground" />
                <p className="mt-3 text-sm text-muted-foreground">{t("doc.empty")}</p>
              </div>
            ) : visible.length === 0 ? (
              <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                {t("doc.noResults")}
              </div>
            ) : (
              visible.map((item) => {
                if (item.kind === "generated") {
                  const doc = item.doc;
                  const createdDay = documentCreatedDay(doc.createdAt);
                  return (
                    <div key={doc.id} className="rounded-2xl border bg-card p-3">
                      <div className="flex items-center gap-3">
                        <FileText className="size-5 shrink-0 text-primary" />
                        <button
                          type="button"
                          className="min-w-0 flex-1 text-left"
                          onClick={() => handleOpenGenerated(doc)}
                        >
                          <p className="truncate text-sm font-semibold">{doc.name}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {t(`doc.cat.${doc.category}`)} · {t("doc.source.generated")} ·{" "}
                            {formatSize(doc.size)}
                            {createdDay ? ` · ${formatDate(createdDay)}` : ""}
                            {doc.payloadStatus === "downloaded_only" ? ` · ${t("doc.downloadedOnly")}` : ""}
                          </p>
                        </button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t("doc.redownload")}
                          onClick={() => handleRedownload(doc)}
                        >
                          <Download className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t("doc.delete")}
                          onClick={() => handleDeleteGenerated(doc)}
                        >
                          <Trash2 className="size-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  );
                }

                const doc = item.doc;
                const job = jobs.find((j) => j.id === doc.job_id);
                const folder = folders.find((f) => f.id === doc.folder_id);
                const createdDay = documentCreatedDay(doc.created_at);
                return (
                  <div key={doc.id} className="rounded-2xl border bg-card p-3">
                    <div className="flex items-center gap-3">
                      <FileText className="size-5 shrink-0 text-primary" />
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        onClick={() => void handleOpenUpload(doc)}
                      >
                        <p className="truncate text-sm font-semibold">{doc.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {t(`doc.cat.${doc.category}`)} · {t("doc.source.upload")} ·{" "}
                          {formatSize(doc.size)}
                          {createdDay ? ` · ${formatDate(createdDay)}` : ""}
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
                        onClick={() => void handleDeleteUpload(doc)}
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

          {signedIn ? (
            <>
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
          ) : null}
        </>
      )}
    </main>
  );
}
