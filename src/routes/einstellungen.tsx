import { createFileRoute } from "@tanstack/react-router";
import { CloudDownload, CloudUpload, Lock, LogOut } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { SupplementRow } from "@/components/minijob/JobDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuthSession } from "@/hooks/use-auth-session";
import { Skeleton } from "@/components/ui/skeleton";
import { signInWithOAuthProvider } from "@/lib/minijob/oauth-sign-in";
import { markOAuthPending } from "@/lib/minijob/storage-scope";
import { LocalDataImportSection } from "@/components/minijob/LocalDataImport";
import { formatDateDE, formatEuro, formatHours, isoDate } from "@/lib/minijob/calc";
import { monthlyHoursLimit, monthlyLimitOf, yearlyLimitOf } from "@/lib/minijob/limits";
import {
  backupNow,
  forceFailStuckSync,
  performSignOut,
  restoreNow,
  resolveConflict,
  retryPending,
  SYNC_TIMEOUT_MS,
  useSyncState,
} from "@/lib/minijob/cloud";

import { downloadText, shiftsToCsv } from "@/lib/minijob/csv";
import { exportXlsx } from "@/lib/minijob/export";
import { holidaysFor } from "@/lib/minijob/holidays";
import {
  markBackup,
  notificationPermission,
  requestNotificationPermission,
} from "@/lib/minijob/notify";
import {
  canOfferBiometricToggle,
  detectBiometricCapability,
  type BiometricCapability,
} from "@/lib/minijob/biometric";
import { setupBiometricInScope } from "@/lib/minijob/biometric-setup";
import { restoreLocalBackupFile } from "@/lib/minijob/local-backup-restore";
import { syncActionErrorMessage } from "@/lib/minijob/sync-action-error";
import { isValidPin, validatePinConfirm } from "@/lib/minijob/pin";
import {
  disableBiometric,
  getActiveScope,
  getData,
  updateSettings,
  updateSupplements,
  useAppData,
} from "@/lib/minijob/store";
import { LANGUAGES, useT } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n";
import { ACCENTS, THEME_MODES } from "@/lib/minijob/theme";
import { UI_MODES, isPreviewPending, previewVisibility, type Feature } from "@/lib/minijob/uimode";
import {
  BUNDESLAENDER,
  COUNTRIES,
  type NotificationSettings,
  type TextSize,
  type TouchSize,
  type UiMode,
} from "@/lib/minijob/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/einstellungen")({
  head: () => ({
    meta: [
      { title: "Einstellungen – MiniJob Tracker" },
      {
        name: "description",
        content:
          "Design und Akzentfarbe, Zuschläge, Feiertage nach Bundesland, PIN-Schutz sowie Cloud-Backup deiner Arbeitszeiten verwalten.",
      },
      { property: "og:title", content: "Einstellungen – MiniJob Tracker" },
      {
        property: "og:description",
        content: "Design, Zuschläge, Feiertage, Sicherheit und Cloud-Backup verwalten.",
      },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { settings, shifts } = useAppData();
  const { t } = useT();
  const [pinSetupOpen, setPinSetupOpen] = useState(false);
  const [pinDraft, setPinDraft] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [bioCapability, setBioCapability] = useState<BiometricCapability>("unsupported");
  const [previewMode, setPreviewMode] = useState<UiMode | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void detectBiometricCapability().then((cap) => {
      if (!cancelled) setBioCapability(cap);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedUiMode: UiMode = previewMode ?? settings.uiMode;
  const previewPending = isPreviewPending(settings.uiMode, previewMode);

  return (
    <main className="mx-auto max-w-lg px-4 pt-6">
      <h1 className="text-2xl font-extrabold tracking-tight">{t("set.title")}</h1>

      <Tabs defaultValue="allgemein" className="mt-4">
        <TabsList className="w-full">
          <TabsTrigger value="allgemein" className="flex-1">
            {t("set.tabs.general")}
          </TabsTrigger>
          <TabsTrigger value="design" className="flex-1">
            {t("set.tabs.design")}
          </TabsTrigger>
          <TabsTrigger value="lohn" className="flex-1">
            {t("set.tabs.wage")}
          </TabsTrigger>
          <TabsTrigger value="konto" className="flex-1">
            {t("set.tabs.account")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="allgemein" className="mt-4 space-y-4 pb-6">
          <Section title={t("set.defaults.title")}>
            <div className="grid gap-1.5">
              <Label htmlFor="mitarbeiter-name">{t("worklog.employeeName")}</Label>
              <Input
                id="mitarbeiter-name"
                value={settings.employeeName ?? ""}
                placeholder={t("worklog.employeeNamePlaceholder")}
                onChange={(e) => updateSettings({ employeeName: e.target.value })}
              />
            </div>
            <NumberField
              id="std-lohn"
              label={t("set.defaults.rate")}
              value={settings.defaultRate}
              step="0.5"
              onCommit={(v) => updateSettings({ defaultRate: v })}
            />
            {settings.limitAuto ? (
              <div className="rounded-xl border bg-muted/40 p-3">
                <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Lock className="size-3.5" />
                  {t("set.limits.legalSource")}
                </div>
                <div className="mt-2 flex items-center justify-between gap-2 text-sm">
                  <span className="text-muted-foreground">{t("set.defaults.monthlyLimit")}</span>
                  <span className="font-semibold tabular-nums">
                    {formatEuro(monthlyLimitOf(settings))}
                  </span>
                </div>
              </div>
            ) : (
              <NumberField
                id="grenze"
                label={t("set.defaults.monthlyLimit")}
                value={settings.monthlyLimit}
                step="10"
                onCommit={(v) => updateSettings({ monthlyLimit: v })}
              />
            )}

            <label className="flex items-center justify-between gap-3 pt-1">
              <span className="text-sm">
                {t("set.limits.legalAuto")}
                <span className="block text-xs text-muted-foreground">
                  {t("set.limits.legalAutoHint")}
                </span>
              </span>
              <Switch
                checked={settings.limitAuto}
                onCheckedChange={(v) =>
                  updateSettings({
                    limitAuto: v,
                    ...(v ? {} : { monthlyLimit: monthlyLimitOf(settings) }),
                  })
                }
              />
            </label>

            {settings.hoursLimitAuto ? (
              <div className="rounded-xl border bg-muted/40 p-3">
                <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Lock className="size-3.5" />
                  {t("set.limits.auto")}
                </div>
                <div className="mt-2 flex items-center justify-between gap-2 text-sm">
                  <span className="text-muted-foreground">{t("set.defaults.hoursLimit")}</span>
                  <span className="font-semibold tabular-nums">
                    {formatHours(monthlyHoursLimit(settings))}
                  </span>
                </div>
              </div>
            ) : (
              <NumberField
                id="stunden-grenze"
                label={t("set.defaults.hoursLimit")}
                value={settings.hoursLimitMonthly}
                step="1"
                onCommit={(v) => updateSettings({ hoursLimitMonthly: v })}
              />
            )}

            <label className="flex items-center justify-between gap-3 pt-1">
              <span className="text-sm">
                {t("set.limits.hoursAuto")}
                <span className="block text-xs text-muted-foreground">
                  {t("set.limits.hoursAutoHint")}
                </span>
              </span>
              <Switch
                checked={settings.hoursLimitAuto}
                onCheckedChange={(v) =>
                  updateSettings({
                    hoursLimitAuto: v,
                    ...(v
                      ? {}
                      : {
                          hoursLimitMonthly:
                            settings.hoursLimitMonthly ||
                            Math.round(monthlyHoursLimit(settings) * 100) / 100,
                        }),
                  })
                }
              />
            </label>

            <div className="rounded-xl border bg-muted/40 p-3">
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Lock className="size-3.5" />
                {t("set.limits.auto")}
              </div>
              <div className="mt-2 flex items-center justify-between gap-2 text-sm">
                <span className="text-muted-foreground">{t("set.defaults.yearlyLimit")}</span>
                <span className="font-semibold tabular-nums">
                  {formatEuro(yearlyLimitOf(settings))}
                </span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">{t("set.limits.formula")}</p>
            </div>
          </Section>

          <Section title={t("set.holidays.title")}>
            <div className="grid gap-2">
              <Label htmlFor="staat">{t("label.country")}</Label>
              <select
                id="staat"
                value={settings.country}
                onChange={(e) => updateSettings({ country: e.target.value })}
                className="h-10 rounded-md border bg-background px-2 text-sm"
              >
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="land">{t("label.state")}</Label>
              <select
                id="land"
                value={settings.bundesland}
                onChange={(e) => updateSettings({ bundesland: e.target.value })}
                className="h-10 rounded-md border bg-background px-2 text-sm"
              >
                {BUNDESLAENDER.map((b) => (
                  <option key={b.code} value={b.code}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
            <ul className="max-h-40 space-y-1 overflow-y-auto text-xs text-muted-foreground">
              {holidaysFor(new Date().getFullYear(), settings.bundesland).map((h) => (
                <li key={h.date} className="flex justify-between">
                  <span>{h.name}</span>
                  <span className="tabular-nums">{formatDateDE(h.date)}</span>
                </li>
              ))}
            </ul>
          </Section>

          <Section title={t("set.language.title")}>
            <p className="text-xs text-muted-foreground">{t("set.language.hint")}</p>
            <select
              value={settings.language}
              onChange={(e) => updateSettings({ language: e.target.value as Lang })}
              className="h-10 rounded-md border bg-background px-2 text-sm"
              aria-label={t("label.language")}
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.native}
                </option>
              ))}
            </select>
          </Section>

          <Section title={t("set.security.title")}>
            <ToggleRow
              title={t("set.security.pin")}
              description={t("set.security.pinDesc")}
              checked={settings.pinEnabled}
              onChange={(checked) => {
                if (!checked) {
                  setPinSetupOpen(false);
                  setPinDraft("");
                  setPinConfirm("");
                  setPinError(null);
                  updateSettings({ pinEnabled: false });
                  return;
                }
                if (!isValidPin(settings.pin)) {
                  toast.error(t("set.security.pinRequired"));
                  setPinSetupOpen(true);
                  setPinDraft("");
                  setPinConfirm("");
                  setPinError(null);
                  return;
                }
                updateSettings({ pinEnabled: true });
              }}
            />
            {settings.pinEnabled || pinSetupOpen ? (
              <div
                className="grid gap-2"
                data-testid="pin-setup"
                style={{
                  paddingBottom: "max(0.5rem, env(safe-area-inset-bottom, 0px))",
                }}
              >
                <Label htmlFor="pin">{t("set.security.pinLabel")}</Label>
                <Input
                  id="pin"
                  type="password"
                  inputMode="numeric"
                  maxLength={8}
                  autoFocus={pinSetupOpen && !settings.pinEnabled}
                  value={pinDraft}
                  onChange={(e) => {
                    setPinDraft(e.target.value);
                    setPinError(null);
                  }}
                  aria-invalid={Boolean(pinError)}
                />
                <Label htmlFor="pin-confirm">{t("set.security.pinConfirm")}</Label>
                <Input
                  id="pin-confirm"
                  type="password"
                  inputMode="numeric"
                  maxLength={8}
                  value={pinConfirm}
                  onChange={(e) => {
                    setPinConfirm(e.target.value);
                    setPinError(null);
                  }}
                  aria-invalid={Boolean(pinError)}
                />
                {pinError ? (
                  <p
                    className="text-xs text-destructive"
                    role="alert"
                    data-testid="pin-setup-error"
                  >
                    {pinError}
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button
                    type="button"
                    className="min-h-11 flex-1"
                    data-testid="pin-setup-save"
                    onClick={() => {
                      const result = validatePinConfirm(pinDraft, pinConfirm);
                      if (!result.ok) {
                        const key =
                          result.error === "short"
                            ? "set.security.pinErrorShort"
                            : result.error === "mismatch"
                              ? "set.security.pinErrorMismatch"
                              : result.error === "cancel"
                                ? "set.security.pinErrorCancel"
                                : "set.security.pinErrorInvalid";
                        setPinError(t(key));
                        toast.error(t(key));
                        if (settings.pinEnabled && result.error !== "mismatch") {
                          updateSettings({ pinEnabled: false });
                        }
                        return;
                      }
                      updateSettings({ pin: result.pin, pinEnabled: true });
                      setPinSetupOpen(false);
                      setPinDraft("");
                      setPinConfirm("");
                      setPinError(null);
                      toast.success(t("set.security.pinSaved"));
                    }}
                  >
                    {t("set.security.pinSave")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11 flex-1"
                    data-testid="pin-setup-cancel"
                    onClick={() => {
                      const cancelled = validatePinConfirm(pinDraft, pinConfirm, { cancel: true });
                      if (!cancelled.ok) {
                        setPinError(t("set.security.pinErrorCancel"));
                        toast.message(t("set.security.pinErrorCancel"));
                      }
                      setPinSetupOpen(false);
                      setPinDraft("");
                      setPinConfirm("");
                      if (!isValidPin(settings.pin)) {
                        updateSettings({ pinEnabled: false });
                      }
                    }}
                  >
                    {t("set.security.pinCancel")}
                  </Button>
                </div>
              </div>
            ) : null}
            <ToggleRow
              title={t("set.security.biometric")}
              description={
                canOfferBiometricToggle(bioCapability)
                  ? t("set.security.biometricDesc")
                  : bioCapability === "unsupported"
                    ? t("set.security.biometricUnsupported")
                    : t("set.security.biometricUnavailable")
              }
              checked={settings.biometric && Boolean(settings.biometricCredentialId)}
              disabled={!canOfferBiometricToggle(bioCapability)}
              onChange={async (checked) => {
                if (!checked) {
                  disableBiometric();
                  return;
                }
                if (!canOfferBiometricToggle(bioCapability)) {
                  toast.error(t("set.security.biometricUnavailable"));
                  return;
                }
                if (!isValidPin(settings.pin)) {
                  toast.error(t("set.security.pinRequired"));
                  setPinSetupOpen(true);
                  return;
                }
                // WebAuthn-Dialog kann dauern: schreibt nie in ein inzwischen
                // aktives anderes Konto (Namensraum-Snapshot im Helfer).
                const outcome = await setupBiometricInScope(settings.pin ?? "minijob-local");
                if (outcome === "stale") return;
                if (!outcome.ok) {
                  toast.error(
                    outcome.result === "unavailable"
                      ? t("set.security.biometricUnavailable")
                      : t("pin.biometricFailed"),
                  );
                  return;
                }
                toast.success(t("pin.biometricReady"));
              }}
            />
          </Section>

          <Notifications value={settings.notifications} />

          <DataMigration shiftCount={shifts.length} />

          <LocalBackup shiftCount={shifts.length} />

          <Section title={t("set.setup.title")}>
            <p className="text-xs text-muted-foreground">{t("set.setup.desc")}</p>
            <Button
              variant="outline"
              onClick={() => {
                updateSettings({ onboarded: false });
                window.location.reload();
              }}
            >
              {t("set.setup.start")}
            </Button>
          </Section>
        </TabsContent>

        <TabsContent value="design" className="mt-4 space-y-4 pb-6">
          <Section title={t("set.design.mode")}>
            <div className="grid grid-cols-3 gap-2">
              {THEME_MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => updateSettings({ themeMode: m.id })}
                  className={cn(
                    "rounded-xl border py-2 text-sm font-medium",
                    settings.themeMode === m.id ? "border-primary bg-primary/10" : "bg-card",
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </Section>

          <Section title={t("set.design.accent")}>
            <div className="grid grid-cols-3 gap-2">
              {ACCENTS.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => updateSettings({ accent: a.id })}
                  className={cn(
                    "flex items-center gap-2 rounded-xl border px-3 py-2 text-sm",
                    settings.accent === a.id
                      ? "border-primary bg-primary/10 font-semibold"
                      : "bg-card",
                  )}
                >
                  <span className="size-4 rounded-full" style={{ backgroundColor: a.swatch }} />
                  {a.label}
                </button>
              ))}
            </div>
          </Section>

          <Section title={t("ui.title")}>
            <p className="text-xs text-muted-foreground">{t("ui.hint")}</p>
            <div className="grid gap-2" data-testid="ui-mode-picker">
              {UI_MODES.map((mode) => {
                const applied = settings.uiMode === mode;
                const selected = selectedUiMode === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setPreviewMode(mode)}
                    aria-pressed={selected}
                    data-applied={applied ? "true" : "false"}
                    data-preview-selected={selected ? "true" : "false"}
                    className={cn(
                      "rounded-xl border px-3 py-3 text-left",
                      selected ? "border-primary bg-primary/10" : "bg-card",
                    )}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="block text-sm font-semibold">{t(`ui.${mode}`)}</span>
                      {applied ? (
                        <span className="text-[10px] font-medium uppercase tracking-wide text-primary">
                          {t("ui.applied")}
                        </span>
                      ) : selected && previewPending ? (
                        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                          {t("ui.selected")}
                        </span>
                      ) : null}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {t(`ui.${mode}Desc`)}
                    </span>
                  </button>
                );
              })}
            </div>
            <div
              className="flex flex-wrap gap-2 pt-1"
              style={{ paddingBottom: "max(0.25rem, env(safe-area-inset-bottom, 0px))" }}
            >
              <Button
                type="button"
                variant="outline"
                className="min-h-11 flex-1"
                data-testid="ui-mode-preview"
                onClick={() => {
                  setPreviewMode(selectedUiMode);
                  setPreviewOpen(true);
                }}
              >
                {t("ui.preview")}
              </Button>
              <Button
                type="button"
                className="min-h-11 flex-1"
                data-testid="ui-mode-apply"
                disabled={!previewPending}
                onClick={() => {
                  if (!previewMode) return;
                  updateSettings({ uiMode: previewMode });
                  setPreviewMode(null);
                  setPreviewOpen(false);
                  toast.success(t(`ui.${previewMode}`));
                }}
              >
                {t("ui.apply")}
              </Button>
            </div>
            {previewPending ? (
              <p className="text-xs text-muted-foreground" data-testid="ui-mode-preview-hint">
                {t("ui.previewHint")}
              </p>
            ) : null}
            {previewOpen ? (
              <UiModePreviewOverlay
                mode={selectedUiMode}
                onClose={() => setPreviewOpen(false)}
                onApply={() => {
                  updateSettings({ uiMode: selectedUiMode });
                  setPreviewMode(null);
                  setPreviewOpen(false);
                }}
              />
            ) : null}
          </Section>

          <Section title={t("a11y.title")}>
            <div className="grid gap-2">
              <Label>{t("a11y.textSize")}</Label>
              <div className="grid grid-cols-4 gap-2">
                {(["s", "m", "l", "xl"] as TextSize[]).map((size) => (
                  <button
                    key={size}
                    type="button"
                    onClick={() => updateSettings({ textSize: size })}
                    aria-pressed={settings.textSize === size}
                    className={cn(
                      "rounded-xl border py-2 text-sm font-medium",
                      settings.textSize === size ? "border-primary bg-primary/10" : "bg-card",
                    )}
                  >
                    {t(`a11y.size.${size}`)}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-2">
              <Label>{t("a11y.touch")}</Label>
              <div className="grid grid-cols-3 gap-2">
                {(["normal", "large", "glove"] as TouchSize[]).map((size) => (
                  <button
                    key={size}
                    type="button"
                    onClick={() => updateSettings({ touchSize: size })}
                    aria-pressed={settings.touchSize === size}
                    className={cn(
                      "rounded-xl border px-2 py-2 text-xs font-medium",
                      settings.touchSize === size ? "border-primary bg-primary/10" : "bg-card",
                    )}
                  >
                    {t(`a11y.touch.${size}`)}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">{t("a11y.touchHint")}</p>
            </div>

            <ToggleRow
              title={t("a11y.contrast")}
              description={t("a11y.contrastDesc")}
              checked={settings.highContrast}
              onChange={(highContrast) => updateSettings({ highContrast })}
            />
            <ToggleRow
              title={t("a11y.motion")}
              description={t("a11y.motionDesc")}
              checked={settings.reduceMotion}
              onChange={(reduceMotion) => updateSettings({ reduceMotion })}
            />

            <div className="rounded-xl border bg-card p-3">
              <p className="text-xs text-muted-foreground">{t("a11y.preview")}</p>
              <p className="mt-1 text-sm font-semibold">{t("app.name")}</p>
              <Button className="mt-2 w-full">{t("dash.newEntry")}</Button>
            </div>
          </Section>
        </TabsContent>

        <TabsContent value="lohn" className="mt-4 space-y-3 pb-6">
          <p className="text-xs text-muted-foreground">{t("set.wage.hint")}</p>
          <SupplementRow
            label={t("supp.saturday")}
            value={settings.supplements.saturday}
            onChange={(v) => updateSupplements({ saturday: v })}
          />
          <SupplementRow
            label={t("supp.sunday")}
            value={settings.supplements.sunday}
            onChange={(v) => updateSupplements({ sunday: v })}
          />
          <SupplementRow
            label={t("supp.holiday")}
            value={settings.supplements.holiday}
            onChange={(v) => updateSupplements({ holiday: v })}
          />
          <SupplementRow
            label={t("supp.night")}
            value={settings.supplements.night}
            onChange={(v) => updateSupplements({ night: v })}
          />
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <Label className="text-xs">{t("set.wage.nightFrom")}</Label>
              <Input
                type="time"
                value={settings.supplements.nightStart}
                onChange={(e) => updateSupplements({ nightStart: e.target.value })}
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">{t("set.wage.nightTo")}</Label>
              <Input
                type="time"
                value={settings.supplements.nightEnd}
                onChange={(e) => updateSupplements({ nightEnd: e.target.value })}
              />
            </div>
          </div>
          <SupplementRow
            label={t("supp.overtime")}
            value={settings.supplements.overtime}
            onChange={(v) => updateSupplements({ overtime: v })}
          />
        </TabsContent>

        <TabsContent value="konto" className="mt-4 space-y-4 pb-6">
          <Section title={t("premium.settingsTitle")}>
            <ToggleRow
              title={settings.premium ? t("premium.active") : t("premium.unlock")}
              description={t("premium.settingsDesc")}
              checked={settings.premium === true}
              onChange={(v) => updateSettings({ premium: v })}
            />
          </Section>
          <CloudSync
            autoBackup={settings.autoBackup}
            localDemoMode={settings.localDemoMode === true}
          />
          <LocalDataImportSection />
        </TabsContent>
      </Tabs>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-2xl border bg-card p-4 shadow-card">
      <h2 className="text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

const NAV_PREVIEW: Feature[] = ["nav.stats", "nav.jobs", "nav.docs", "nav.ai"];
const WIDGET_PREVIEW: Feature[] = [
  "dash.statGrid",
  "dash.limitMonth",
  "dash.limitYear",
  "dash.payday",
  "dash.insights",
  "dash.goals",
  "dash.calendar",
];

function UiModePreviewOverlay({
  mode,
  onClose,
  onApply,
}: {
  mode: UiMode;
  onClose: () => void;
  onApply: () => void;
}) {
  const { t } = useT();
  const vis = previewVisibility(mode);
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={t("ui.previewTitle")}
      data-testid="ui-mode-preview-overlay"
      style={{
        paddingTop: "max(1rem, env(safe-area-inset-top, 0px))",
        paddingBottom: "max(1rem, env(safe-area-inset-bottom, 0px))",
        paddingLeft: "max(1rem, env(safe-area-inset-left, 0px))",
        paddingRight: "max(1rem, env(safe-area-inset-right, 0px))",
      }}
    >
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border bg-background p-4 shadow-lg sm:rounded-2xl">
        <h3 className="text-base font-semibold">{t("ui.previewTitle")}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{t("ui.previewHint")}</p>
        <p className="mt-2 text-sm font-medium">{t(`ui.${mode}`)}</p>

        <div className="mt-3 space-y-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("ui.previewNav")}
            </p>
            <ul className="mt-1 space-y-1 text-sm">
              {NAV_PREVIEW.map((f) => (
                <li key={f} className="flex justify-between gap-2">
                  <span>{t(`ui.feature.${f}`)}</span>
                  <span className={vis[f] ? "text-primary" : "text-muted-foreground"}>
                    {vis[f] ? "✓" : "–"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("ui.previewWidgets")}
            </p>
            <ul className="mt-1 space-y-1 text-sm">
              {WIDGET_PREVIEW.map((f) => (
                <li key={f} className="flex justify-between gap-2">
                  <span>{t(`ui.feature.${f}`)}</span>
                  <span className={vis[f] ? "text-primary" : "text-muted-foreground"}>
                    {vis[f] ? "✓" : "–"}
                  </span>
                </li>
              ))}
              <li className="flex justify-between gap-2">
                <span>{t("ui.feature.settings.advanced")}</span>
                <span
                  className={vis["settings.advanced"] ? "text-primary" : "text-muted-foreground"}
                >
                  {vis["settings.advanced"] ? "✓" : "–"}
                </span>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" variant="outline" className="min-h-11 flex-1" onClick={onClose}>
            {t("action.cancel")}
          </Button>
          <Button
            type="button"
            className="min-h-11 flex-1"
            data-testid="ui-mode-preview-apply"
            onClick={onApply}
          >
            {t("ui.apply")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ToggleRow({
  title,
  description,
  checked,
  onChange,
  disabled,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={title} disabled={disabled} />
    </div>
  );
}

function NumberField({
  id,
  label,
  value,
  step,
  onCommit,
}: {
  id: string;
  label: string;
  value: number;
  step: string;
  onCommit: (value: number) => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        step={step}
        min="0"
        inputMode="decimal"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => onCommit(Number(text.replace(",", ".")) || 0)}
      />
    </div>
  );
}

function LocalBackup({ shiftCount }: { shiftCount: number }) {
  const { t } = useT();

  function download() {
    const blob = new Blob([JSON.stringify(getData(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `minijob-backup-${isoDate(new Date())}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(t("set.localBackup.created"));
  }

  function upload(file: File) {
    // Datei wird async gelesen: nur in den Namensraum schreiben, der beim Start aktiv war.
    void restoreLocalBackupFile(file).then((result) => {
      if (result === "stale") return;
      if (result === "invalid") toast.error(t("set.localBackup.invalid"));
      else if (result === "read-error") toast.error(t("error.fileRead"));
      else toast.success(t("set.localBackup.restored"));
    });
  }

  return (
    <Section title={t("set.localBackup.title")}>
      <p className="text-xs text-muted-foreground">
        {t("set.localBackup.desc", { count: shiftCount })}
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Button variant="outline" onClick={download}>
          {t("set.localBackup.export")}
        </Button>
        <Button variant="outline" asChild>
          <label className="cursor-pointer">
            {t("set.localBackup.import")}
            <input
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) upload(file);
                e.target.value = "";
              }}
            />
          </label>
        </Button>
      </div>
    </Section>
  );
}

function SyncStatusRow({ busy, setBusy }: { busy: boolean; setBusy: (value: boolean) => void }) {
  const { t } = useT();
  const sync = useSyncState();

  // UI failsafe: never leave "Wird synchronisiert …" past timeout even if cloud Promise.race fails.
  useEffect(() => {
    if (sync.status !== "syncing") return;
    const id = globalThis.setTimeout(() => {
      forceFailStuckSync();
    }, SYNC_TIMEOUT_MS + 500);
    return () => globalThis.clearTimeout(id);
  }, [sync.status]);

  const label =
    sync.status === "syncing"
      ? t("set.account.cloud.sync.syncing")
      : sync.status === "offline"
        ? t("set.account.cloud.sync.offline")
        : sync.status === "conflict"
          ? sync.lastSyncedAt == null
            ? t("set.account.cloud.sync.conflictFirstSync")
            : t("set.account.cloud.sync.conflict")
          : sync.status === "error"
            ? (sync.message ?? t("set.account.cloud.sync.error"))
            : sync.status === "idle"
              ? sync.pending
                ? t("set.account.cloud.sync.pending")
                : t("set.account.cloud.sync.synced")
              : sync.pending
                ? t("set.account.cloud.sync.pending")
                : t("set.account.cloud.sync.synced");

  const tone =
    sync.status === "error" || sync.status === "conflict"
      ? "text-destructive"
      : "text-muted-foreground";

  async function resolve(keep: "local" | "cloud") {
    setBusy(true);
    try {
      await resolveConflict(keep);
      toast.success(t("set.account.cloud.sync.synced"));
    } catch (error) {
      // Kontowechsel während des Abgleichs (StaleSyncError): still, kein Fehler-Toast.
      const message = syncActionErrorMessage(error, t("error.sync"));
      if (message) toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-border/60 bg-muted/30 p-3">
      <p className="text-xs font-medium">{t("set.account.cloud.sync.status")}</p>
      <p className={`mt-1 text-xs ${tone}`}>{label}</p>
      {sync.status === "conflict" ? (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Button size="sm" onClick={() => resolve("local")} disabled={busy}>
            {t("set.account.cloud.sync.keepLocal")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => resolve("cloud")} disabled={busy}>
            {t("set.account.cloud.sync.keepCloud")}
          </Button>
        </div>
      ) : sync.status === "error" || (sync.pending && sync.status !== "syncing") ? (
        <Button size="sm" variant="outline" className="mt-2" onClick={() => retryPending()}>
          {t("set.account.cloud.sync.retry")}
        </Button>
      ) : null}
    </div>
  );
}

function CloudSync({
  autoBackup,
  localDemoMode = false,
}: {
  autoBackup: boolean;
  localDemoMode?: boolean;
}) {
  const { t } = useT();
  const { status: authStatus, session } = useAuthSession();
  const [busy, setBusy] = useState(false);

  async function oauthGoogle() {
    // Testmodus NICHT vor dem Redirect beenden: Abbruch bei Google → weiter im
    // Testmodus mit allen Daten. Nach Login gilt der eigene Konto-Namensraum.
    markOAuthPending(getActiveScope());
    try {
      const { error } = await signInWithOAuthProvider("google");
      if (error) toast.error(t("error.signIn"));
    } catch {
      toast.error(t("error.signIn"));
    }
  }

  async function run(action: "backup" | "restore") {
    setBusy(true);
    try {
      if (action === "backup") {
        await backupNow();
        markBackup();
        toast.success(t("set.account.cloud.backupSuccess"));
      } else {
        const ok = await restoreNow();
        toast[ok ? "success" : "error"](
          ok ? t("set.account.cloud.restoreSuccess") : t("set.account.cloud.restoreEmpty"),
        );
      }
    } catch (error) {
      // Kontowechsel während des Abgleichs (StaleSyncError): still, kein Fehler-Toast.
      const message = syncActionErrorMessage(error, t("error.sync"));
      if (message) toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  if (authStatus === "loading") {
    return (
      <Section title={t("set.account.signIn.title")}>
        <div aria-busy="true" aria-label="loading" className="space-y-2">
          <Skeleton className="h-10 w-full" />
        </div>
      </Section>
    );
  }

  if (authStatus === "signed_out" || !session) {
    return (
      <Section title={t("set.account.signIn.title")}>
        {localDemoMode ? (
          <>
            <p className="text-xs font-medium text-amber-900 dark:text-amber-100">
              {t("set.account.demo.localOnly")}
            </p>
            <p className="text-xs text-muted-foreground">{t("set.account.demo.signInPrompt")}</p>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">{t("set.account.signIn.desc")}</p>
        )}
        <Button className="w-full" onClick={() => oauthGoogle()}>
          {t("set.account.signIn.google")}
        </Button>
      </Section>
    );
  }

  return (
    <Section title={t("set.account.cloud.title")}>
      <p className="text-xs text-muted-foreground">
        {t("set.account.cloud.signedInAs", { email: session.user.email ?? "" })}
      </p>
      <SyncStatusRow busy={busy} setBusy={setBusy} />

      <ToggleRow
        title={t("set.account.cloud.autoBackup")}
        description={t("set.account.cloud.autoBackupDesc")}
        checked={autoBackup}
        onChange={(checked) => updateSettings({ autoBackup: checked })}
      />
      <div className="grid grid-cols-2 gap-3">
        <Button onClick={() => run("backup")} disabled={busy}>
          <CloudUpload className="size-4" /> {t("set.account.cloud.backup")}
        </Button>
        <Button variant="outline" onClick={() => run("restore")} disabled={busy}>
          <CloudDownload className="size-4" /> {t("set.account.cloud.restore")}
        </Button>
      </div>
      <Button
        variant="ghost"
        className="w-full text-muted-foreground"
        onClick={async () => {
          // Ergebnis prüfen; nur bei Erfolg Konto-Namensraum verlassen (Daten bleiben
          // für dieses Konto gespeichert, sind aber nicht mehr geladen/sichtbar).
          const { ok } = await performSignOut();
          if (!ok) {
            toast.error(t("set.account.cloud.signOutFailed"));
            return;
          }
          toast.success(t("set.account.cloud.signedOut"));
        }}
      >
        <LogOut className="size-4" /> {t("set.account.cloud.signOut")}
      </Button>
    </Section>
  );
}

function Notifications({ value }: { value: NotificationSettings }) {
  const { t } = useT();
  const [permission, setPermission] = useState<string>("default");

  useEffect(() => setPermission(notificationPermission()), []);

  async function enable(checked: boolean) {
    if (!checked) {
      updateSettings({ notifications: { ...value, enabled: false } });
      return;
    }
    const granted = await requestNotificationPermission();
    setPermission(notificationPermission());
    if (!granted) {
      toast.error(t("set.notifications.blocked"));
      return;
    }
    updateSettings({ notifications: { ...value, enabled: true } });
    toast.success(t("set.notifications.enabled"));
  }

  function patch(part: Partial<NotificationSettings>) {
    updateSettings({ notifications: { ...value, ...part } });
  }

  return (
    <Section title={t("set.notifications.title")}>
      {permission === "unsupported" ? (
        <p className="text-xs text-muted-foreground">{t("set.notifications.unsupported")}</p>
      ) : (
        <>
          <ToggleRow
            title={t("set.notifications.push")}
            description={t("set.notifications.pushDesc")}
            checked={value.enabled}
            onChange={(checked) => void enable(checked)}
          />
          {value.enabled ? (
            <>
              <ToggleRow
                title={t("set.notifications.startReminder")}
                description={t("set.notifications.startReminderDesc")}
                checked={value.startReminder}
                onChange={(startReminder) => patch({ startReminder })}
              />
              <ToggleRow
                title={t("set.notifications.endReminder")}
                description={t("set.notifications.endReminderDesc")}
                checked={value.endReminder}
                onChange={(endReminder) => patch({ endReminder })}
              />
              <div className="grid grid-cols-2 gap-2">
                <div className="grid gap-1">
                  <Label className="text-xs">{t("set.notifications.startFrom")}</Label>
                  <Input
                    type="time"
                    value={value.startTime}
                    onChange={(e) => patch({ startTime: e.target.value })}
                  />
                </div>
                <div className="grid gap-1">
                  <Label className="text-xs">{t("set.notifications.endFrom")}</Label>
                  <Input
                    type="time"
                    value={value.endTime}
                    onChange={(e) => patch({ endTime: e.target.value })}
                  />
                </div>
              </div>
              <ToggleRow
                title={t("set.notifications.missingShift")}
                description={t("set.notifications.missingShiftDesc")}
                checked={value.missingShift}
                onChange={(missingShift) => patch({ missingShift })}
              />
              <ToggleRow
                title={t("set.notifications.backupReminder")}
                description={t("set.notifications.backupReminderDesc")}
                checked={value.backupReminder}
                onChange={(backupReminder) => patch({ backupReminder })}
              />
              <ToggleRow
                title={t("set.notifications.limit")}
                description={t("set.notifications.limitDesc")}
                checked={value.limitAlerts}
                onChange={(limitAlerts) => patch({ limitAlerts })}
              />
            </>
          ) : null}
        </>
      )}
    </Section>
  );
}

function DataMigration({ shiftCount }: { shiftCount: number }) {
  const { t } = useT();
  const { shifts, jobs, settings } = useAppData();
  const stamp = isoDate(new Date());

  return (
    <Section title={t("set.migration.title")}>
      <p className="text-xs text-muted-foreground">
        {t("set.migration.desc", { count: shiftCount })}
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Button
          variant="outline"
          onClick={() => {
            downloadText(`minijob-${stamp}.csv`, shiftsToCsv(shifts, jobs));
            toast.success(t("set.migration.csvExported"));
          }}
        >
          {t("set.migration.csv")}
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            exportXlsx(shifts, `minijob-${stamp}`, {
              jobs,
              bundesland: settings.bundesland,
              defaultRate: settings.defaultRate,
              supplements: settings.supplements,
            });
            toast.success(t("set.migration.excelExported"));
          }}
        >
          {t("set.migration.excel")}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t("set.migration.importUnavailable")}</p>
    </Section>
  );
}
