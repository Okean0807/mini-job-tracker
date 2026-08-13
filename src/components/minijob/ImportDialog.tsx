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
  type CsvParseResult,
} from "@/lib/minijob/csv";
import {
  newId,
  nextJobColor,
  replaceAll,
  saveJob,
  saveShifts,
  getData,
} from "@/lib/minijob/store";
import type { AppData, Job, Settings } from "@/lib/minijob/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobs: Job[];
  settings: Settings;
}

export function ImportDialog({ open, onOpenChange, jobs, settings }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<CsvParseResult | null>(null);
  const [fileName, setFileName] = useState("");

  function reset() {
    setResult(null);
    setFileName("");
    if (fileRef.current) fileRef.current.value = "";
  }

  async function handleFile(file: File) {
    setFileName(file.name);
    const lower = file.name.toLowerCase();

    if (lower.endsWith(".json")) {
      try {
        const data = JSON.parse(await file.text()) as Partial<AppData>;
        replaceAll(data);
        toast.success("JSON-Daten importiert");
        onOpenChange(false);
        reset();
      } catch {
        toast.error("JSON-Datei konnte nicht gelesen werden");
      }
      return;
    }

    let text: string;
    if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
      const XLSX = await import("xlsx");
      const book = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const sheetName = book.SheetNames[0];
      if (!sheetName) {
        toast.error("Die Datei enthält keine Tabelle");
        return;
      }
      text = XLSX.utils.sheet_to_csv(book.Sheets[sheetName]!, { FS: ";" });
    } else {
      text = await file.text();
    }

    const parsed = parseCsv(text, { jobs, defaultRate: settings.defaultRate });
    if (parsed.rows.length === 0) {
      toast.error("Keine Datenzeilen gefunden");
      return;
    }
    setResult(parsed);
  }

  function confirmImport() {
    if (!result) return;
    const created = new Map<string, string>();
    for (const name of result.newJobs) {
      const id = newId();
      created.set(name.toLowerCase(), id);
      saveJob({
        id,
        name,
        color: nextJobColor(),
        rate: settings.defaultRate,
        mode: "flex",
      });
    }
    const currentJobs = getData().jobs;
    const shifts = result.valid.map((row) => {
      const shift = { ...row.shift! };
      if (!shift.jobId && row.jobName) {
        const id =
          created.get(row.jobName.toLowerCase()) ??
          currentJobs.find((j) => j.name.toLowerCase() === row.jobName!.toLowerCase())?.id;
        if (id) shift.jobId = id;
      }
      return shift;
    });
    saveShifts(shifts);
    toast.success(`${shifts.length} Einträge importiert`);
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
          <DialogTitle>Daten importieren</DialogTitle>
          <DialogDescription>
            CSV, Excel (XLSX) oder JSON-Sicherung einlesen. Daten werden vor dem Import geprüft.
          </DialogDescription>
        </DialogHeader>

        {!result ? (
          <div className="space-y-3">
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.txt,.json,.xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFile(file);
              }}
            />
            <Button className="w-full" onClick={() => fileRef.current?.click()}>
              <FileUp className="size-4" /> Datei auswählen
            </Button>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => downloadText("minijob-vorlage.csv", csvTemplate())}
            >
              <Download className="size-4" /> CSV-Vorlage herunterladen
            </Button>
            <p className="text-xs text-muted-foreground">
              Spalten: Datum, Beginn, Ende, Pause (Min.), Stundenlohn, Job, Notiz.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm">
              <span className="font-medium">{fileName}</span> · {result.valid.length} gültig,{" "}
              {result.invalid.length} fehlerhaft
            </p>

            {result.newJobs.length > 0 ? (
              <p className="rounded-xl bg-muted p-3 text-xs">
                Neue Jobs werden angelegt: {result.newJobs.join(", ")}
              </p>
            ) : null}

            {result.invalid.length > 0 ? (
              <ul className="max-h-40 space-y-1 overflow-y-auto rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                {result.invalid.slice(0, 20).map((row) => (
                  <li key={row.line} className="flex gap-2">
                    <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                    <span>
                      Zeile {row.line}: {row.errors.join(", ")}
                    </span>
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
                Andere Datei
              </Button>
              <Button className="flex-1" disabled={result.valid.length === 0} onClick={confirmImport}>
                <Check className="size-4" /> {result.valid.length} importieren
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
