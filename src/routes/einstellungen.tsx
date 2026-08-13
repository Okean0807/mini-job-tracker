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

  return (
    <main className="mx-auto max-w-lg px-4 pt-6">
      <h1 className="text-2xl font-extrabold tracking-tight">Einstellungen</h1>

      <Tabs defaultValue="allgemein" className="mt-4">
        <TabsList className="w-full">
          <TabsTrigger value="allgemein" className="flex-1">
            Allgemein
          </TabsTrigger>
          <TabsTrigger value="design" className="flex-1">
            Design
          </TabsTrigger>
          <TabsTrigger value="lohn" className="flex-1">
            Lohn
          </TabsTrigger>
          <TabsTrigger value="konto" className="flex-1">
            Konto
          </TabsTrigger>
        </TabsList>

        <TabsContent value="allgemein" className="mt-4 space-y-4 pb-6">
          <Section title="Standardwerte">
            <NumberField
              id="std-lohn"
              label="Standard-Stundenlohn (€)"
              value={settings.defaultRate}
              step="0.5"
              onCommit={(v) => updateSettings({ defaultRate: v })}
            />
            <NumberField
              id="grenze"
              label="Monatliche Minijob-Grenze (€)"
              value={settings.monthlyLimit}
              step="10"
              onCommit={(v) => updateSettings({ monthlyLimit: v })}
            />
            <NumberField
              id="jahr-grenze"
              label="Jährliche Minijob-Grenze (€)"
              value={settings.yearlyLimit}
              step="100"
              onCommit={(v) => updateSettings({ yearlyLimit: v })}
            />
          </Section>

          <Section title="Feiertage">
            <div className="grid gap-2">
              <Label htmlFor="staat">Land</Label>
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
              <Label htmlFor="land">Bundesland</Label>
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

          <Section title="Sprache">
            <p className="text-xs text-muted-foreground">
              Die App ist vollständig auf Deutsch. Weitere Sprachen folgen.
            </p>
            <select
              value="de"
              disabled
              className="h-10 rounded-md border bg-muted px-2 text-sm"
              aria-label="Sprache"
            >
              <option value="de">Deutsch</option>
            </select>
          </Section>

          <Section title="Sicherheit">
            <ToggleRow
              title="PIN-Schutz"
              description="App beim Start mit PIN sperren"
              checked={settings.pinEnabled}
              onChange={(checked) => updateSettings({ pinEnabled: checked })}
            />
            {settings.pinEnabled ? (
              <div className="grid gap-2">
                <Label htmlFor="pin">PIN (4–8 Ziffern)</Label>
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
              title="Biometrisch entsperren"
              description="Fingerabdruck oder Gesichtserkennung nutzen"
              checked={settings.biometric}
              onChange={(checked) => updateSettings({ biometric: checked })}
            />
          </Section>

          <Notifications value={settings.notifications} />

          <DataMigration shiftCount={shifts.length} />

          <LocalBackup shiftCount={shifts.length} />

          <Section title="Einrichtung">
            <p className="text-xs text-muted-foreground">
              Den Einrichtungsassistenten erneut starten (Arbeitsart, Region, Lohn, Zuschläge).
            </p>
            <Button
              variant="outline"
              onClick={() => {
                updateSettings({ onboarded: false });
                window.location.reload();
              }}
            >
              Assistent starten
            </Button>
          </Section>
        </TabsContent>

        <TabsContent value="design" className="mt-4 space-y-4 pb-6">
          <Section title="Modus">
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

          <Section title="Akzentfarbe">
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
          <p className="text-xs text-muted-foreground">
            Standard-Zuschläge für alle Jobs ohne eigene Regeln. Prozent oder fester Betrag pro Stunde.
          </p>
          <SupplementRow
            label="Samstag"
            value={settings.supplements.saturday}
            onChange={(v) => updateSupplements({ saturday: v })}
          />
          <SupplementRow
            label="Sonntag"
            value={settings.supplements.sunday}
            onChange={(v) => updateSupplements({ sunday: v })}
          />
          <SupplementRow
            label="Feiertag"
            value={settings.supplements.holiday}
            onChange={(v) => updateSupplements({ holiday: v })}
          />
          <SupplementRow
            label="Nacht"
            value={settings.supplements.night}
            onChange={(v) => updateSupplements({ night: v })}
          />
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <Label className="text-xs">Nacht ab</Label>
              <Input
                type="time"
                value={settings.supplements.nightStart}
                onChange={(e) => updateSupplements({ nightStart: e.target.value })}
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">Nacht bis</Label>
              <Input
                type="time"
                value={settings.supplements.nightEnd}
                onChange={(e) => updateSupplements({ nightEnd: e.target.value })}
              />
            </div>
          </div>
          <SupplementRow
            label="Überstunden"
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
  function download() {
    const blob = new Blob([JSON.stringify(getData(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `minijob-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Backup-Datei erstellt");
  }

  function upload(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        replaceAll(JSON.parse(String(reader.result)) as AppData);
        toast.success("Backup wiederhergestellt");
      } catch {
        toast.error("Datei konnte nicht gelesen werden.");
      }
    };
    reader.readAsText(file);
  }

  return (
    <Section title="Lokales Backup">
      <p className="text-xs text-muted-foreground">
        {shiftCount} Einträge auf diesem Gerät gespeichert.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Button variant="outline" onClick={download}>
          Exportieren
        </Button>
        <Button variant="outline" asChild>
          <label className="cursor-pointer">
            Importieren
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
      toast.error("Anmeldung nicht möglich. Bitte erneut versuchen.");
    }
  }

  async function run(action: "backup" | "restore") {
    setBusy(true);
    try {
      if (action === "backup") {
        await backupNow();
        markBackup();
        toast.success("In der Cloud gesichert");
      } else {
        const ok = await restoreNow();
        toast[ok ? "success" : "error"](
          ok ? "Daten aus der Cloud geladen" : "Keine Cloud-Sicherung gefunden.",
        );
      }
    } catch {
      toast.error("Synchronisierung fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  if (!session) {
    return (
      <Section title="Anmelden">
        <p className="text-xs text-muted-foreground">
          Melde dich an, damit deine Daten automatisch gesichert und auf einem neuen Gerät
          wiederhergestellt werden.
        </p>
        <Button className="w-full" onClick={() => oauth("google")}>
          Mit Google anmelden
        </Button>
        <Button variant="outline" className="w-full" onClick={() => oauth("apple")}>
          Mit Apple anmelden
        </Button>
      </Section>
    );
  }

  return (
    <Section title="Cloud-Sicherung">
      <p className="text-xs text-muted-foreground">Angemeldet als {session.user.email}</p>
      <ToggleRow
        title="Automatisches Backup"
        description="Änderungen automatisch in der Cloud sichern"
        checked={autoBackup}
        onChange={(checked) => updateSettings({ autoBackup: checked })}
      />
      <div className="grid grid-cols-2 gap-3">
        <Button onClick={() => run("backup")} disabled={busy}>
          <CloudUpload className="size-4" /> Sichern
        </Button>
        <Button variant="outline" onClick={() => run("restore")} disabled={busy}>
          <CloudDownload className="size-4" /> Laden
        </Button>
      </div>
      <Button
        variant="ghost"
        className="w-full text-muted-foreground"
        onClick={async () => {
          await supabase.auth.signOut();
          toast.success("Abgemeldet");
        }}
      >
        <LogOut className="size-4" /> Abmelden
      </Button>
    </Section>
  );
}

function Notifications({ value }: { value: NotificationSettings }) {
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
      toast.error("Benachrichtigungen wurden im Browser blockiert.");
      return;
    }
    updateSettings({ notifications: { ...value, enabled: true } });
    toast.success("Benachrichtigungen aktiviert");
  }

  function patch(part: Partial<NotificationSettings>) {
    updateSettings({ notifications: { ...value, ...part } });
  }

  return (
    <Section title="Benachrichtigungen">
      {permission === "unsupported" ? (
        <p className="text-xs text-muted-foreground">
          Dieses Gerät unterstützt keine Benachrichtigungen.
        </p>
      ) : (
        <>
          <ToggleRow
            title="Push-Nachrichten"
            description="Erinnerungen und Minijob-Warnungen erhalten"
            checked={value.enabled}
            onChange={(checked) => void enable(checked)}
          />
          {value.enabled ? (
            <>
              <ToggleRow
                title="Start-Erinnerung"
                description="Erinnerung, die Zeiterfassung zu starten"
                checked={value.startReminder}
                onChange={(startReminder) => patch({ startReminder })}
              />
              <ToggleRow
                title="Ende-Erinnerung"
                description="Erinnerung, die laufende Zeit zu beenden"
                checked={value.endReminder}
                onChange={(endReminder) => patch({ endReminder })}
              />
              <div className="grid grid-cols-2 gap-2">
                <div className="grid gap-1">
                  <Label className="text-xs">Start ab</Label>
                  <Input
                    type="time"
                    value={value.startTime}
                    onChange={(e) => patch({ startTime: e.target.value })}
                  />
                </div>
                <div className="grid gap-1">
                  <Label className="text-xs">Ende ab</Label>
                  <Input
                    type="time"
                    value={value.endTime}
                    onChange={(e) => patch({ endTime: e.target.value })}
                  />
                </div>
              </div>
              <ToggleRow
                title="Fehlende Schicht"
                description="Hinweis, wenn an einem Werktag nichts erfasst wurde"
                checked={value.missingShift}
                onChange={(missingShift) => patch({ missingShift })}
              />
              <ToggleRow
                title="Backup-Erinnerung"
                description="Wöchentlich an eine Sicherung erinnern"
                checked={value.backupReminder}
                onChange={(backupReminder) => patch({ backupReminder })}
              />
              <ToggleRow
                title="Minijob-Limit"
                description="Warnung bei 75 %, 90 % und 100 % der Grenze"
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
  const { shifts, jobs, settings } = useAppData();
  const [importOpen, setImportOpen] = useState(false);
  const stamp = new Date().toISOString().slice(0, 10);

  return (
    <Section title="Datenübertragung">
      <p className="text-xs text-muted-foreground">
        {shiftCount} Einträge exportieren oder Daten aus CSV, Excel bzw. JSON importieren.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Button
          variant="outline"
          onClick={() => {
            downloadText(`minijob-${stamp}.csv`, shiftsToCsv(shifts, jobs));
            toast.success("CSV exportiert");
          }}
        >
          CSV export
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            exportXlsx(shifts, `minijob-${stamp}`, { jobs, bundesland: settings.bundesland });
            toast.success("Excel exportiert");
          }}
        >
          Excel export
        </Button>
      </div>
      <Button className="w-full" onClick={() => setImportOpen(true)}>
        <FileUp className="size-4" /> Daten importieren
      </Button>
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} jobs={jobs} settings={settings} />
    </Section>
  );
}
