import { useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";
import { useSyncState } from "@/lib/minijob/cloud";
import {
  declineImport,
  discardLegacyData,
  findCandidate,
  findDemoCandidate,
  findLegacyCandidate,
  importLocalData,
  pendingPromptSources,
  type ImportCandidate,
  type ImportResult,
  type ImportSource,
} from "@/lib/minijob/local-data-import";
import { scopeSuffix } from "@/lib/minijob/storage-scope";
import { getActiveScope, onScopeChange, useAppData } from "@/lib/minijob/store";

function useScopeSuffix(): string {
  return useSyncExternalStore(
    (l) => onScopeChange(() => l()),
    () => scopeSuffix(getActiveScope()),
    () => "guest",
  );
}

function resultToast(t: (k: string) => string, result: ImportResult) {
  if (result === "imported") toast.success(t("local.import.done"));
  else if (result === "refused-unsynced") toast.error(t("local.import.refusedUnsynced"));
  else if (result === "refused-not-empty") toast.error(t("local.import.refusedNotEmpty"));
  else if (result === "not-eligible") toast.error(t("local.import.notEligible"));
}

function countsOf(c: ImportCandidate) {
  return { shifts: c.counts.shifts, jobs: c.counts.jobs, docs: c.counts.docs };
}

/**
 * Einmaliger, expliziter Dialog: „Lokale Daten gefunden“ (Legacy) bzw.
 * „Testdaten übernehmen / Mit leerem Konto starten“ nach Login aus dem Testmodus.
 * Liegt über Assistent/PIN-freiem Inhalt (z-[70]); nichts passiert ohne Klick.
 */
export function LocalDataImportPrompt() {
  const { t } = useT();
  const scope = useScopeSuffix();
  const { signedIn } = useSyncState();
  const data = useAppData();
  const [version, setVersion] = useState(0);
  const [snoozed, setSnoozed] = useState<Set<string>>(() => new Set());

  const [source, setSource] = useState<ImportSource | undefined>(undefined);
  const [candidate, setCandidate] = useState<ImportCandidate | null>(null);

  // Neu bewerten bei Scope-/Login-Wechsel, Datenänderung oder nach einer Entscheidung.
  useEffect(() => {
    const next = pendingPromptSources().find((s) => !snoozed.has(`${scope}:${s}`));
    setSource(next);
    setCandidate(next ? findCandidate(next) : null);
  }, [scope, signedIn, version, snoozed, data]);

  if (!source || !candidate) return null;
  const inAccount = scope.startsWith("u:");
  const isDemo = source === "demo";

  function done() {
    setVersion((v) => v + 1);
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="local-import-title"
    >
      <div className="w-full max-w-md space-y-3 rounded-2xl border bg-card p-5 shadow-card">
        <h2 id="local-import-title" className="text-base font-semibold">
          {t(isDemo ? "local.import.demo.title" : "local.import.legacy.title")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t(isDemo ? "local.import.demo.body" : "local.import.legacy.body", countsOf(candidate))}
        </p>
        {candidate.lastSyncedWithThisAccount ? (
          <p className="text-xs font-medium">{t("local.import.legacy.sameAccount")}</p>
        ) : null}
        {inAccount ? (
          <p className="text-xs text-muted-foreground">{t("local.import.cloudHint")}</p>
        ) : null}
        <div className="grid gap-2">
          <Button
            onClick={() => {
              resultToast(t, importLocalData(source));
              done();
            }}
          >
            {t(
              isDemo
                ? "local.import.demo.import"
                : inAccount
                  ? "local.import.legacy.import"
                  : "local.import.legacy.importLocal",
            )}
          </Button>
          {isDemo ? (
            <Button
              variant="outline"
              onClick={() => {
                declineImport("demo");
                done();
              }}
            >
              {t("local.import.demo.empty")}
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => setSnoozed((prev) => new Set(prev).add(`${scope}:${source}`))}
              >
                {t("local.import.later")}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  declineImport("legacy");
                  done();
                }}
              >
                {t("local.import.ignore")}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Einstellungen → Konto: dauerhafter Zugang zu Import / Löschen alter Daten. */
export function LocalDataImportSection() {
  const { t } = useT();
  const scope = useScopeSuffix();
  const { signedIn } = useSyncState();
  const data = useAppData();
  const [version, setVersion] = useState(0);
  const [legacy, setLegacy] = useState<ImportCandidate | null>(null);
  const [demo, setDemo] = useState<ImportCandidate | null>(null);

  useEffect(() => {
    setLegacy(findLegacyCandidate());
    setDemo(findDemoCandidate());
  }, [scope, signedIn, version, data]);

  if (!legacy && !demo) return null;
  const inAccount = scope.startsWith("u:");

  return (
    <section className="space-y-3 rounded-2xl border bg-card p-4 shadow-card">
      <h2 className="text-sm font-semibold">{t("local.section.title")}</h2>
      <p className="text-xs text-muted-foreground">{t("local.section.desc")}</p>
      {legacy ? (
        <div className="space-y-2">
          <p className="text-sm font-medium">{t("local.section.legacy")}</p>
          <p className="text-xs text-muted-foreground">
            {t("local.section.counts", countsOf(legacy))}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Button
              size="sm"
              onClick={() => {
                resultToast(t, importLocalData("legacy"));
                setVersion((v) => v + 1);
              }}
            >
              {t(inAccount ? "local.import.legacy.import" : "local.import.legacy.importLocal")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                if (
                  typeof window === "undefined" ||
                  !window.confirm(t("local.section.discardConfirm"))
                ) {
                  return;
                }
                discardLegacyData();
                toast.success(t("local.section.discarded"));
                setVersion((v) => v + 1);
              }}
            >
              {t("local.section.discard")}
            </Button>
          </div>
        </div>
      ) : null}
      {demo ? (
        <div className="space-y-2">
          <p className="text-sm font-medium">{t("local.section.demo")}</p>
          <p className="text-xs text-muted-foreground">
            {t("local.section.counts", countsOf(demo))}
          </p>
          <Button
            size="sm"
            onClick={() => {
              resultToast(t, importLocalData("demo"));
              setVersion((v) => v + 1);
            }}
          >
            {t("local.import.demo.import")}
          </Button>
        </div>
      ) : null}
      {inAccount ? (
        <p className="text-xs text-muted-foreground">{t("local.import.cloudHint")}</p>
      ) : null}
    </section>
  );
}
