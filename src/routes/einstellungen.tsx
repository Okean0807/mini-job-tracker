import { createFileRoute } from "@tanstack/react-router";
import type { Session } from "@supabase/supabase-js";
import { CloudDownload, CloudUpload, LogOut, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { getData, replaceAll, updateSettings, useAppData } from "@/lib/minijob/store";
import type { AppData } from "@/lib/minijob/types";

export const Route = createFileRoute("/einstellungen")({
  head: () => ({
    meta: [
      { title: "Einstellungen – MiniJob Tracker" },
      {
        name: "description",
        content:
          "Standard-Stundenlohn, Minijob-Grenze, Dark Mode sowie Cloud-Backup und Wiederherstellung deiner Arbeitszeiten.",
      },
      { property: "og:title", content: "Einstellungen – MiniJob Tracker" },
      {
        property: "og:description",
        content: "Stundenlohn, Dark Mode und Cloud-Backup verwalten.",
      },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { settings, shifts } = useAppData();
  const [rate, setRate] = useState(String(settings.defaultRate));
  const [limit, setLimit] = useState(String(settings.monthlyLimit));

  useEffect(() => {
    setRate(String(settings.defaultRate));
    setLimit(String(settings.monthlyLimit));
  }, [settings.defaultRate, settings.monthlyLimit]);

  return (
    <main className="mx-auto max-w-lg px-4 pt-6">
      <h1 className="text-2xl font-extrabold tracking-tight">Einstellungen</h1>

      <section className="mt-5 space-y-4 rounded-2xl border bg-card p-4 shadow-card">
        <h2 className="text-sm font-semibold">Standardwerte</h2>
        <div className="grid gap-2">
          <Label htmlFor="std-lohn">Standard-Stundenlohn (€)</Label>
          <Input
            id="std-lohn"
            type="number"
            step="0.5"
            min="0"
            inputMode="decimal"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            onBlur={() => updateSettings({ defaultRate: Number(rate.replace(",", ".")) || 0 })}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="grenze">Monatliche Minijob-Grenze (€)</Label>
          <Input
            id="grenze"
            type="number"
            step="10"
            min="0"
            inputMode="decimal"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            onBlur={() => updateSettings({ monthlyLimit: Number(limit.replace(",", ".")) || 0 })}
          />
        </div>
      </section>

      <section className="mt-4 rounded-2xl border bg-card p-4 shadow-card">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {settings.theme === "dark" ? (
              <Moon className="size-5 text-primary" />
            ) : (
              <Sun className="size-5 text-primary" />
            )}
            <div>
              <p className="text-sm font-semibold">Dark Mode</p>
              <p className="text-xs text-muted-foreground">Dunkles Design aktivieren</p>
            </div>
          </div>
          <Switch
            checked={settings.theme === "dark"}
            onCheckedChange={(checked) => updateSettings({ theme: checked ? "dark" : "light" })}
            aria-label="Dark Mode umschalten"
          />
        </div>
      </section>

      <LocalBackup />
      <CloudSync shiftCount={shifts.length} />

      <p className="mt-6 pb-4 text-center text-xs text-muted-foreground">
        Deine Daten werden lokal auf diesem Gerät gespeichert. Für ein Backup nutze die Cloud-Sicherung.
      </p>
    </main>
  );
}

function LocalBackup() {
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
        const parsed = JSON.parse(String(reader.result)) as AppData;
        replaceAll(parsed);
        toast.success("Backup wiederhergestellt");
      } catch {
        toast.error("Datei konnte nicht gelesen werden.");
      }
    };
    reader.readAsText(file);
  }

  return (
    <section className="mt-4 space-y-3 rounded-2xl border bg-card p-4 shadow-card">
      <h2 className="text-sm font-semibold">Lokales Backup</h2>
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
    </section>
  );
}

function CloudSync({ shiftCount }: { shiftCount: number }) {
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => sub.subscription.unsubscribe();
  }, []);

  async function signIn() {
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) toast.error("Anmeldung fehlgeschlagen: " + error.message);
    else toast.success("Angemeldet");
  }

  async function signUp() {
    setBusy(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: window.location.origin },
    });
    setBusy(false);
    if (error) toast.error("Registrierung fehlgeschlagen: " + error.message);
    else toast.success("Konto erstellt. Bitte E-Mail bestätigen, falls angefordert.");
  }

  async function push() {
    if (!session) return;
    setBusy(true);
    const { error } = await supabase
      .from("backups")
      .upsert({
        user_id: session.user.id,
        payload: JSON.parse(JSON.stringify(getData())),
        updated_at: new Date().toISOString(),
      });
    setBusy(false);
    if (error) toast.error("Sicherung fehlgeschlagen: " + error.message);
    else toast.success("In der Cloud gesichert");
  }

  async function pull() {
    if (!session) return;
    setBusy(true);
    const { data, error } = await supabase
      .from("backups")
      .select("payload")
      .eq("user_id", session.user.id)
      .maybeSingle();
    setBusy(false);
    if (error) {
      toast.error("Laden fehlgeschlagen: " + error.message);
      return;
    }
    if (!data?.payload) {
      toast.error("Keine Cloud-Sicherung gefunden.");
      return;
    }
    replaceAll(data.payload as unknown as AppData);
    toast.success("Daten aus der Cloud geladen");
  }

  return (
    <section className="mt-4 space-y-3 rounded-2xl border bg-card p-4 shadow-card">
      <h2 className="text-sm font-semibold">Cloud-Sicherung</h2>
      {session ? (
        <>
          <p className="text-xs text-muted-foreground">
            Angemeldet als {session.user.email} · {shiftCount} Schichten auf diesem Gerät
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Button onClick={push} disabled={busy}>
              <CloudUpload className="size-4" /> Sichern
            </Button>
            <Button variant="outline" onClick={pull} disabled={busy}>
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
        </>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            Melde dich an, um deine Daten geräteübergreifend zu sichern.
          </p>
          <div className="grid gap-2">
            <Label htmlFor="mail">E-Mail</Label>
            <Input
              id="mail"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="pw">Passwort</Label>
            <Input
              id="pw"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Button onClick={signIn} disabled={busy || !email || !password}>
              Anmelden
            </Button>
            <Button variant="outline" onClick={signUp} disabled={busy || !email || !password}>
              Registrieren
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
