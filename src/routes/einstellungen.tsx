import { createFileRoute } from "@tanstack/react-router";
import type { Session } from "@supabase/supabase-js";
import { CloudDownload, CloudUpload, FileUp, LogOut } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { ImportDialog } from "@/components/minijob/ImportDialog";
import { SupplementRow } from "@/components/minijob/JobDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { lovable } from "@/integrations/lovable";
import { supabase } from "@/integrations/supabase/client";
import { formatDateDE } from "@/lib/minijob/calc";
import { backupNow, restoreNow } from "@/lib/minijob/cloud";
import { downloadText, shiftsToCsv } from "@/lib/minijob/csv";
import { exportXlsx } from "@/lib/minijob/export";
import { holidaysFor } from "@/lib/minijob/holidays";
import { markBackup, notificationPermission, requestNotificationPermission } from "@/lib/minijob/notify";
import { getData, replaceAll, updateSettings, updateSupplements, useAppData } from "@/lib/minijob/store";
import { LANGUAGES, useT } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n";
import { ACCENTS, THEME_MODES } from "@/lib/minijob/theme";
import { BUNDESLAENDER, COUNTRIES, type AppData, type NotificationSettings } from "@/lib/minijob/types";
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
            <NumberField
              id="std-lohn"
              label={t("set.defaults.rate")}
              value={settings.defaultRate}
              step="0.5"
              onCommit={(v) => updateSettings({ defaultRate: v })}
            />
            <NumberField
              id="grenze"
              label={t("set.defaults.monthlyLimit")}
              value={settings.monthlyLimit}
              step="10"
              onCommit={(v) => updateSettings({ monthlyLimit: v })}
            />
            <NumberField
              id="stunden-grenze"
              label={t("set.defaults.hoursLimit")}
              value={settings.hoursLimitMonthly}
              step="1"
              onCommit={(v) => updateSettings({ hoursLimitMonthly: v })}
            />
            <NumberField
              id="jahr-grenze"
              label={t("set.defaults.yearlyLimit")}
              value={settings.yearlyLimit}
              step="100"
              onCommit={(v) => updateSettings({ yearlyLimit: v })}
            />
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
              onChange={(checked) => updateSettings({ pinEnabled: checked })}
            />
            {settings.pinEnabled ? (
              <div className="grid gap-2">
                <Label htmlFor="pin">{t("set.security.pinLabel")}</Label>
                <Input
                  id="pin"
                  type="password"
                  inputMode="numeric"
                  maxLength={8}
                  defaultValue={settings.pin ?? ""}
                  onBlur={(e) => updateSettings({ pin: e.target.value })}
                />
              </div>
            ) : null}
            <ToggleRow
              title={t("set.security.biometric")}
              description={t("set.security.biometricDesc")}
              checked={settings.biometric}
              onChange={(checked) => updateSettings({ biometric: checked })}
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
                    settings.accent === a.id ? "border-primary bg-primary/10 font-semibold" : "bg-card",
                  )}
                >
                  <span className="size-4 rounded-full" style={{ backgroundColor: a.swatch }} />
                  {a.label}
                </button>
              ))}
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
          <CloudSync autoBackup={settings.autoBackup} />
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

function ToggleRow({
  title,
  description,
  checked,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={title} />
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
    a.download = `minijob-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(t("set.localBackup.created"));
  }

  function upload(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        replaceAll(JSON.parse(String(reader.result)) as AppData);
        toast.success(t("set.localBackup.restored"));
      } catch {
        toast.error(t("error.fileRead"));
      }
    };
    reader.readAsText(file);
  }

  return (
    <Section title={t("set.localBackup.title")}>
      <p className="text-xs text-muted-foreground">{t("set.localBackup.desc", { count: shiftCount })}</p>
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

function CloudSync({ autoBackup }: { autoBackup: boolean }) {
  const { t } = useT();
  const [session, setSession] = useState<Session | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => sub.subscription.unsubscribe();
  }, []);

  async function oauth(provider: "google" | "apple") {
    try {
      await lovable.auth.signInWithOAuth(provider, { redirect_uri: window.location.origin });
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
    } catch {
      toast.error(t("error.sync"));
    } finally {
      setBusy(false);
    }
  }

  if (!session) {
    return (
      <Section title={t("set.account.signIn.title")}>
        <p className="text-xs text-muted-foreground">{t("set.account.signIn.desc")}</p>
        <Button className="w-full" onClick={() => oauth("google")}>
          {t("set.account.signIn.google")}
        </Button>
        <Button variant="outline" className="w-full" onClick={() => oauth("apple")}>
          {t("set.account.signIn.apple")}
        </Button>
      </Section>
    );
  }

  return (
    <Section title={t("set.account.cloud.title")}>
      <p className="text-xs text-muted-foreground">
        {t("set.account.cloud.signedInAs", { email: session.user.email ?? "" })}
      </p>
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
          await supabase.auth.signOut();
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
  const [importOpen, setImportOpen] = useState(false);
  const stamp = new Date().toISOString().slice(0, 10);

  return (
    <Section title={t("set.migration.title")}>
      <p className="text-xs text-muted-foreground">{t("set.migration.desc", { count: shiftCount })}</p>
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
            exportXlsx(shifts, `minijob-${stamp}`, { jobs, bundesland: settings.bundesland });
            toast.success(t("set.migration.excelExported"));
          }}
        >
          {t("set.migration.excel")}
        </Button>
      </div>
      <Button className="w-full" onClick={() => setImportOpen(true)}>
        <FileUp className="size-4" /> {t("set.migration.import")}
      </Button>
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} jobs={jobs} settings={settings} />
    </Section>
  );
}
