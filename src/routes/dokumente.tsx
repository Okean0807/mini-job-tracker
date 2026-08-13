import { createFileRoute } from "@tanstack/react-router";
import type { Session } from "@supabase/supabase-js";
import { FileText, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

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
  uploadDocument,
  type DocumentRow,
} from "@/lib/minijob/documents";
import { useAppData } from "@/lib/minijob/store";

export const Route = createFileRoute("/dokumente")({
  head: () => ({
    meta: [
      { title: "Dokumente – MiniJob Tracker" },
      {
        name: "description",
        content:
          "Arbeitsverträge, Lohnabrechnungen und Bescheinigungen als PDF sicher speichern, nach Job und Kategorie sortiert.",
      },
      { property: "og:title", content: "Dokumente – MiniJob Tracker" },
      {
        property: "og:description",
        content: "Verträge, Lohnabrechnungen und Bescheinigungen sicher in der Cloud verwalten.",
      },
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
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState<string>("vertrag");
  const [jobId, setJobId] = useState<string>("none");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, next) => setSession(next));
    return () => sub.subscription.unsubscribe();
  }, []);

  const refresh = useCallback(async () => {
    try {
      setDocs(await listDocuments());
    } catch {
      /* ohne Anmeldung keine Liste */
    }
  }, []);

  useEffect(() => {
    if (session) void refresh();
    else setDocs([]);
  }, [session, refresh]);

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
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      setFile(null);
      setNote("");
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
              <Label htmlFor="doc-note">{t("doc.note")}</Label>
              <Input id="doc-note" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>

            <Button className="w-full" onClick={() => void handleUpload()} disabled={busy}>
              <Upload className="mr-2 size-4" />
              {busy ? t("doc.uploading") : t("doc.upload")}
            </Button>
          </section>

          <section className="mt-5 space-y-2 pb-4">
            {docs.length === 0 ? (
              <div className="rounded-2xl border border-dashed p-8 text-center">
                <FileText className="mx-auto size-8 text-muted-foreground" />
                <p className="mt-3 text-sm text-muted-foreground">{t("doc.empty")}</p>
              </div>
            ) : (
              docs.map((doc) => {
                const job = jobs.find((j) => j.id === doc.job_id);
                return (
                  <div
                    key={doc.id}
                    className="flex items-center gap-3 rounded-2xl border bg-card p-3"
                  >
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
                      aria-label={t("doc.delete")}
                      onClick={() => void handleDelete(doc)}
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </div>
                );
              })
            )}
          </section>
        </>
      )}
    </main>
  );
}
