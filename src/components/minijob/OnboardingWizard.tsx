import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { lovable } from "@/integrations/lovable";
import { newId, nextJobColor, saveJob, updateSettings } from "@/lib/minijob/store";
import {
  BUNDESLAENDER,
  COUNTRIES,
  DEFAULT_SUPPLEMENTS,
  WORK_MODE_LABEL,
  type Settings,
  type Supplement,
  type Supplements,
  type WorkMode,
} from "@/lib/minijob/types";
import { cn } from "@/lib/utils";

const STEPS = [
  "Sprache",
  "Arbeitsart",
  "Region",
  "Stundenlohn",
  "Zuschläge",
  "Cloud",
  "Erster Job",
];

interface Props {
  settings: Settings;
  onDone: () => void;
}

export function OnboardingWizard({ settings, onDone }: Props) {
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<WorkMode>("flex");
  const [country, setCountry] = useState(settings.country);
  const [bundesland, setBundesland] = useState(settings.bundesland);
  const [rate, setRate] = useState(String(settings.defaultRate));
  const [supplements, setSupplements] = useState<Supplements>(settings.supplements ?? DEFAULT_SUPPLEMENTS);
  const [jobName, setJobName] = useState("");
  const [employer, setEmployer] = useState("");

  const numericRate = Number(rate.replace(",", ".")) || 0;

  function finish() {
    updateSettings({
      country,
      bundesland,
      defaultRate: numericRate,
      supplements,
      onboarded: true,
    });
    const name = jobName.trim();
    if (name) {
      saveJob({
        id: newId(),
        name,
        color: nextJobColor(),
        rate: numericRate,
        mode,
        ...(employer.trim() ? { employer: employer.trim() } : {}),
        supplements,
      });
    }
    toast.success("Einrichtung abgeschlossen");
    onDone();
  }

  async function oauth(provider: "google" | "apple") {
    updateSettings({ country, bundesland, defaultRate: numericRate, supplements });
    try {
      await lovable.auth.signInWithOAuth(provider, { redirect_uri: window.location.origin });
    } catch {
      toast.error("Anmeldung nicht möglich. Bitte erneut versuchen.");
    }
  }

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-background">
      <div className="mx-auto flex min-h-screen max-w-lg flex-col px-4 py-6">
        <header>
          <p className="text-xs font-medium text-muted-foreground">
            Schritt {step + 1} von {STEPS.length} · {STEPS[step]}
          </p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight">Einrichtungsassistent</h1>
          <div className="mt-3 flex gap-1" aria-hidden>
            {STEPS.map((s, i) => (
              <span
                key={s}
                className={cn("h-1.5 flex-1 rounded-full", i <= step ? "bg-primary" : "bg-muted")}
              />
            ))}
          </div>
        </header>

        <div className="mt-6 flex-1 space-y-4">
          {step === 0 ? (
            <Card title="Sprache wählen" hint="Weitere Sprachen folgen.">
              <Choice label="Deutsch" active onClick={() => undefined} />
            </Card>
          ) : null}

          {step === 1 ? (
            <Card title="Wie arbeitest du?" hint="Bestimmt, wie Schichten erfasst werden.">
              {(Object.keys(WORK_MODE_LABEL) as WorkMode[]).map((m) => (
                <Choice
                  key={m}
                  label={WORK_MODE_LABEL[m]}
                  active={mode === m}
                  onClick={() => setMode(m)}
                />
              ))}
            </Card>
          ) : null}

          {step === 2 ? (
            <Card title="Land und Region" hint="Für automatische Feiertage.">
              <div className="grid gap-2">
                <Label htmlFor="ob-land">Land</Label>
                <select
                  id="ob-land"
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  className="h-10 rounded-md border bg-background px-2 text-sm"
                >
                  {COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              {country === "DE" ? (
                <div className="grid gap-2">
                  <Label htmlFor="ob-bl">Bundesland</Label>
                  <select
                    id="ob-bl"
                    value={bundesland}
                    onChange={(e) => setBundesland(e.target.value)}
                    className="h-10 rounded-md border bg-background px-2 text-sm"
                  >
                    {BUNDESLAENDER.map((b) => (
                      <option key={b.code} value={b.code}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Feiertage können später manuell als Eintrag erfasst werden.
                </p>
              )}
            </Card>
          ) : null}

          {step === 3 ? (
            <Card title="Stundenlohn" hint="Kann pro Job und pro Schicht angepasst werden.">
              <div className="grid gap-2">
                <Label htmlFor="ob-rate">Standard-Stundenlohn (€)</Label>
                <Input
                  id="ob-rate"
                  type="number"
                  inputMode="decimal"
                  step="0.5"
                  min="0"
                  value={rate}
                  onChange={(e) => setRate(e.target.value)}
                />
              </div>
            </Card>
          ) : null}

          {step === 4 ? (
            <Card title="Zuschläge" hint="Prozent vom Stundenlohn. Später änderbar.">
              {(
                [
                  ["sunday", "Sonntag"],
                  ["holiday", "Feiertag"],
                  ["night", "Nachtschicht"],
                  ["overtime", "Überstunden"],
                ] as const
              ).map(([key, label]) => {
                const value = supplements[key] as Supplement;
                return (
                  <div key={key} className="flex items-center gap-3">
                    <Switch
                      checked={value.enabled}
                      aria-label={label}
                      onCheckedChange={(enabled) =>
                        setSupplements((s) => ({ ...s, [key]: { ...value, enabled } }))
                      }
                    />
                    <span className="flex-1 text-sm font-medium">{label}</span>
                    <Input
                      type="number"
                      inputMode="decimal"
                      className="w-20"
                      value={value.value}
                      disabled={!value.enabled}
                      onChange={(e) =>
                        setSupplements((s) => ({
                          ...s,
                          [key]: { ...value, mode: "prozent", value: Number(e.target.value) || 0 },
                        }))
                      }
                    />
                    <span className="text-sm text-muted-foreground">%</span>
                  </div>
                );
              })}
            </Card>
          ) : null}

          {step === 5 ? (
            <Card
              title="Cloud-Backup aktivieren"
              hint="Deine Daten werden nach der Anmeldung automatisch gesichert und auf einem neuen Gerät wiederhergestellt."
            >
              <Button className="w-full" onClick={() => oauth("google")}>
                Mit Google anmelden
              </Button>
              <Button variant="outline" className="w-full" onClick={() => oauth("apple")}>
                Mit Apple anmelden
              </Button>
              <p className="text-xs text-muted-foreground">
                Du kannst diesen Schritt überspringen und dich später in den Einstellungen anmelden.
              </p>
            </Card>
          ) : null}

          {step === 6 ? (
            <Card title="Ersten Job anlegen" hint="Name genügt – Details später ergänzen.">
              <div className="grid gap-2">
                <Label htmlFor="ob-job">Jobname</Label>
                <Input
                  id="ob-job"
                  value={jobName}
                  placeholder="z. B. Café Nord"
                  onChange={(e) => setJobName(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="ob-emp">Arbeitgeber (optional)</Label>
                <Input id="ob-emp" value={employer} onChange={(e) => setEmployer(e.target.value)} />
              </div>
            </Card>
          ) : null}
        </div>

        <footer className="sticky bottom-0 mt-6 flex gap-3 bg-background py-3">
          {step > 0 ? (
            <Button variant="outline" onClick={() => setStep((s) => s - 1)}>
              <ArrowLeft className="size-4" /> Zurück
            </Button>
          ) : (
            <Button
              variant="ghost"
              className="text-muted-foreground"
              onClick={() => {
                updateSettings({ onboarded: true });
                onDone();
              }}
            >
              Überspringen
            </Button>
          )}
          {step < STEPS.length - 1 ? (
            <Button className="flex-1" onClick={() => setStep((s) => s + 1)}>
              Weiter <ArrowRight className="size-4" />
            </Button>
          ) : (
            <Button className="flex-1" onClick={finish}>
              <Check className="size-4" /> Fertig
            </Button>
          )}
        </footer>
      </div>
    </div>
  );
}

function Card({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-2xl border bg-card p-4 shadow-card">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Choice({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full rounded-xl border px-4 py-3 text-left text-sm font-medium",
        active ? "border-primary bg-primary/10" : "bg-background",
      )}
    >
      {label}
    </button>
  );
}
