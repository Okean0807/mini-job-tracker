import { AlertTriangle, Check, Download, FileUp } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  csvTemplate,
  downloadText,
  parseCsv,
  duplicateShiftIndexes,
  type CsvParseResult,
} from "@/lib/minijob/csv";
import {
  newId,
  nextJobColor,
  saveJob,
  saveShifts,
  getData,
} from "@/lib/minijob/store";
import { importFileKind, MAX_IMPORT_BYTES } from "@/lib/minijob/import-file-kind";
import type { Job, Settings } from "@/lib/minijob/types";
import { useT } from "@/lib/i18n";

import { BackupRestoreSummary, useBackupRestore } from "./BackupRestore";

// Android's picker maps extension-only filters to MIME types and can grey out a
// valid CSV whose stored type differs (text/csv vs. text/comma-separated-values),
// so MIME wildcards are listed too. Format checks stay in handleFile.
export const IMPORT_FILE_ACCEPT =
  ".csv,.txt,.json,text/*,application/json,application/csv,application/vnd.ms-excel";

function formatFileSize(bytes: number) {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobs: Job[];
  settings: Settings;
}

export function ImportDialog({ open, onOpenChange, jobs, settings }: Props) {
  const { t } = useT();
  const fileRef = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<CsvParseResult | null>(null);
  const [fileName, setFileName] = useState("");
  const [duplicateCount, setDuplicateCount] = useState(0);
  const [picked, setPicked] = useState<{ name: string; size: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function fail(message: string) {
    toast.error(message);
    setError(message);
  }

  // JSON-Sicherungen ersetzen den gesamten Bestand: erst Prüfung, dann Bestätigung.
  const restore = useBackupRestore({
    onError: setError,
    onRestored: () => {
      onOpenChange(false);
      reset();
    },
  });

  function reset() {
    restore.cancel();
    setPicked(null);
    setError(null);
    setResult(null);
    setFileName("");
    setDuplicateCount(0);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function handleFile(file: File) {
    setFileName(file.name);
    setError(null);
    const kind = importFileKind(file.name);

    if (file.size > MAX_IMPORT_BYTES) {
      fail(t("imp.fileTooLarge"));
      return;
    }

    if (kind === "json") {
      await restore.pick(file);
      return;
    }

    if (kind === "spreadsheet") {
      // XLS/XLSX parsing was removed from the client import path. The old
      // SheetJS dependency was unmaintained and expanded the attack surface.
      fail(t("imp.xlsxUnsupported"));
      return;
    }

    let text: string;
    try {
      text = await file.text();
    } catch {
      fail(t("imp.readError"));
      return;
    }

    // Parsing only builds a preview; nothing is written until confirmImport().
    // A malformed file must surface as a toast, never as an unhandled rejection.
    let parsed: CsvParseResult;
    let duplicates: number;
    try {
      parsed = parseCsv(text, { jobs, defaultRate: settings.defaultRate });
      const incoming = parsed.valid.flatMap((row) => (row.shift ? [row.shift] : []));
      duplicates = duplicateShiftIndexes(incoming, getData().shifts, getData().jobs).size;
    } catch {
      fail(t("imp.readError"));
      return;
    }
    if (parsed.rows.length === 0) {
      fail(t("imp.noRows"));
      return;
    }
    setResult(parsed);
    setDuplicateCount(duplicates);
  }

  function confirmImport() {
    if (!result) return;
    const created = new Map<string, string>();
    for (const name of result.newJobs) {
      const id = newId();
      created.set(name.toLowerCase(), id);
      saveJob({ id, name, color: nextJobColor(), mode: "flex" });
    }
    const currentJobs = getData().jobs;
    const incoming = result.valid.map((row) => {
      const shift = { ...row.shift! };
      if (!shift.jobId && row.jobName) {
        const id =
          created.get(row.jobName.toLowerCase()) ??
          currentJobs.find((j) => j.name.toLowerCase() === row.jobName!.toLowerCase())?.id;
        if (id) shift.jobId = id;
      }
      return shift;
    });
    const jobsAfterCreation = getData().jobs;
    const duplicateIndexes = duplicateShiftIndexes(incoming, getData().shifts, jobsAfterCreation);
    const shifts = incoming.filter((_, index) => !duplicateIndexes.has(index));
    saveShifts(shifts);
    toast.success(t("imp.imported", { count: shifts.length }));
    onOpenChange(false);
    reset();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) reset();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("imp.title")}</DialogTitle>
          <DialogDescription>{t("imp.desc")}</DialogDescription>
        </DialogHeader>

        {restore.pending ? (
          <BackupRestoreSummary
            prepared={restore.pending}
            onCancel={restore.cancel}
            onConfirm={restore.confirm}
          />
        ) : !result ? (
          <div className="space-y-3">
            <input
              ref={fileRef}
              type="file"
              accept={IMPORT_FILE_ACCEPT}
              className="hidden"
              onChange={(e) => {
                const input = e.currentTarget;
                const file = input.files?.[0];
                // Clear so picking the same file again fires `change` again.
                input.value = "";
                if (!file) return;
                setError(null);
                setPicked({ name: file.name, size: file.size });
                handleFile(file).catch(() => fail(t("imp.readError")));
              }}
            />
            <Button className="w-full" onClick={() => fileRef.current?.click()}>
              <FileUp className="size-4" /> {t("imp.selectFile")}
            </Button>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => downloadText("minijob-vorlage.csv", csvTemplate())}
            >
              <Download className="size-4" /> {t("imp.downloadTemplate")}
            </Button>
            {picked ? (
              <p className="text-xs" data-testid="import-selected">
                {picked.name} · {formatFileSize(picked.size)}
              </p>
            ) : null}
            {error ? (
              <p role="alert" className="text-xs text-destructive" data-testid="import-error">
                {error}
              </p>
            ) : null}
            <p className="text-xs text-muted-foreground">{t("imp.columnsHint")}</p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm">
              <span className="font-medium">{fileName}</span> ·{" "}
              {t("imp.summary", { valid: result.valid.length, invalid: result.invalid.length })}
            </p>

            {duplicateCount > 0 ? (
              <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
                {duplicateCount} doppelte Zeile(n) werden beim Import automatisch übersprungen.
              </p>
            ) : null}

            {result.newJobs.length > 0 ? (
              <p className="rounded-xl bg-muted p-3 text-xs">
                {t("imp.newJobs", { jobs: result.newJobs.join(", ") })}
              </p>
            ) : null}

            {result.invalid.length > 0 ? (
              <ul className="max-h-40 space-y-1 overflow-y-auto rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                {result.invalid.slice(0, 20).map((row) => (
                  <li key={row.line} className="flex gap-2">
                    <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                    <span>{t("imp.lineError", { line: row.line, errors: row.errors.join(", ") })}</span>
                  </li>
                ))}
              </ul>
            ) : null}

            <ul className="max-h-48 space-y-1 overflow-y-auto rounded-xl border p-3 text-xs">
              {result.valid.slice(0, 30).map((row) => (
                <li key={row.line} className="flex justify-between gap-2">
                  <span>
                    {row.shift!.date} · {row.shift!.start}–{row.shift!.end}
                  </span>
                  <span className="text-muted-foreground">{row.jobName ?? "–"}</span>
                </li>
              ))}
            </ul>

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={reset}>
                {t("imp.otherFile")}
              </Button>
              <Button className="flex-1" disabled={result.valid.length === 0} onClick={confirmImport}>
                <Check className="size-4" /> {t("imp.confirm", { count: result.valid.length })}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
