import { FileUp } from "lucide-react";
import { useState } from "react";

import { ImportDialog } from "@/components/minijob/ImportDialog";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";
import type { Job, Settings } from "@/lib/minijob/types";

/**
 * Entry point for the data import (CSV/TXT shifts, JSON backup) in Settings → General →
 * "Datenübertragung". The dialog itself (file kind, 2 MiB limit, preview, duplicate skip)
 * is the existing ImportDialog; this only opens it on an explicit tap.
 */
export function DataImportButton({ jobs, settings }: { jobs: Job[]; settings: Settings }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="min-h-11 w-full"
        aria-haspopup="dialog"
        data-testid="data-import-open"
        onClick={() => setOpen(true)}
      >
        <FileUp className="size-4" aria-hidden="true" />
        {t("set.migration.import")}
      </Button>
      <ImportDialog open={open} onOpenChange={setOpen} jobs={jobs} settings={settings} />
    </>
  );
}
