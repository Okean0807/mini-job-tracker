import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { signInWithOAuthProvider } from "@/lib/minijob/oauth-sign-in";
import {
  checkpointOnboardingBeforeOAuth,
  clearOnboardingDraft,
  loadOnboardingDraft,
} from "@/lib/minijob/onboarding-draft";
import { LANGUAGES } from "@/lib/i18n/core";
import { useT } from "@/lib/i18n";
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

interface Props {
  settings: Settings;
  onDone: () => void;
}

export function OnboardingWizard({ settings, onDone }: Props) {
  const { t } = useT();
  const STEPS = [
    t("wiz.step.language"),
    t("wiz.step.workMode"),
    t("wiz.step.region"),
    t("wiz.step.rate"),
    t("wiz.step.supplements"),
    t("wiz.step.cloud"),
    t("wiz.step.firstJob"),
  ];
  const WORK_MODE_KEY: Record<WorkMode, string> = {
    flex: "mode.flex",
    fest: "mode.fest",
    selbststaendig: "mode.selbststaendig",
  };

  // Resume after OAuth full-page return (draft in localStorage; settings from store).
  const [draft] = useState(() => loadOnboardingDraft(STEPS.length));
  const [step, setStep] = useState(draft?.step ?? 0);
  const [mode, setMode] = useState<WorkMode>(draft?.mode ?? "flex");
  const [country, setCountry] = useState(settings.country);
  const [bundesland, setBundesland] = useState(settings.bundesland);
  const [rate, setRate] = useState(String(settings.defaultRate));
  const [supplements, setSupplements] = useState<Supplements>(settings.supplements ?? DEFAULT_SUPPLEMENTS);
  const [jobName, setJobName] = useState("");
  const [employer, setEmployer] = useState("");

  const numericRate = Number(rate.replace(",", ".")) || 0;

  function finish() {
    clearOnboardingDraft();
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
    toast.success(t("wiz.toast.done"));
    onDone();
  }

  async function oauth(provider: "google" | "apple") {
    // Persist region/rate/supplements + step/mode before browser leaves for Google/Apple.
    checkpointOnboardingBeforeOAuth({
      step,
      mode,
      persistSettings: () =>
        updateSettings({ country, bundesland, defaultRate: numericRate, supplements }),
    });
    try {
      const { error } = await signInWithOAuthProvider(provider);
      if (error) toast.error(t("error.signIn"));
    } catch {
      toast.error(t("error.signIn"));
    }
  }

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-background">
      <div className="mx-auto flex min-h-screen max-w-lg flex-col px-4 py-6">
        <header>
          <p className="text-xs font-medium text-muted-foreground">
            {t("wiz.stepOf", { current: step + 1, total: STEPS.length, step: STEPS[step] ?? "" })}
          </p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight">{t("wiz.title")}</h1>
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
            <Card title={t("wiz.language.title")} hint={t("wiz.language.hint")}>
              {LANGUAGES.map((l) => (
                <Choice
                  key={l.code}
                  label={l.native}
                  active={settings.language === l.code}
                  onClick={() => updateSettings({ language: l.code })}
                />
              ))}
            </Card>
          ) : null}

          {step === 1 ? (
            <Card title={t("wiz.workMode.title")} hint={t("wiz.workMode.hint")}>
              {(Object.keys(WORK_MODE_LABEL) as WorkMode[]).map((m) => (
                <Choice
                  key={m}
                  label={t(WORK_MODE_KEY[m])}
                  active={mode === m}
                  onClick={() => setMode(m)}
                />
              ))}
            </Card>
          ) : null}

          {step === 2 ? (
            <Card title={t("wiz.region.title")} hint={t("wiz.region.hint")}>
              <div className="grid gap-2">
                <Label htmlFor="ob-land">{t("wiz.region.country")}</Label>
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
                  <Label htmlFor="ob-bl">{t("wiz.region.state")}</Label>
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
                <p className="text-xs text-muted-foreground">{t("wiz.region.noStateHint")}</p>
              )}
            </Card>
          ) : null}

          {step === 3 ? (
            <Card title={t("wiz.rate.title")} hint={t("wiz.rate.hint")}>
              <div className="grid gap-2">
                <Label htmlFor="ob-rate">{t("wiz.rate.label")}</Label>
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
            <Card title={t("wiz.supplements.title")} hint={t("wiz.supplements.hint")}>
              {(
                [
                  ["sunday", "supp.sunday"],
                  ["holiday", "supp.holiday"],
                  ["night", "supp.night"],
                  ["overtime", "supp.overtime"],
                ] as const
              ).map(([key, labelKey]) => {
                const value = supplements[key] as Supplement;
                const label = t(labelKey);
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
            <Card title={t("wiz.cloud.title")} hint={t("wiz.cloud.hint")}>
              <Button className="w-full" onClick={() => oauth("google")}>
                {t("wiz.cloud.google")}
              </Button>
              <Button variant="outline" className="w-full" onClick={() => oauth("apple")}>
                {t("wiz.cloud.apple")}
              </Button>
              <p className="text-xs text-muted-foreground">{t("wiz.cloud.skipHint")}</p>
            </Card>
          ) : null}

          {step === 6 ? (
            <Card title={t("wiz.firstJob.title")} hint={t("wiz.firstJob.hint")}>
              <div className="grid gap-2">
                <Label htmlFor="ob-job">{t("wiz.firstJob.name")}</Label>
                <Input
                  id="ob-job"
                  value={jobName}
                  placeholder={t("wiz.firstJob.namePlaceholder")}
                  onChange={(e) => setJobName(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="ob-emp">{t("wiz.firstJob.employer")}</Label>
                <Input id="ob-emp" value={employer} onChange={(e) => setEmployer(e.target.value)} />
              </div>
            </Card>
          ) : null}
        </div>

        <footer className="sticky bottom-0 mt-6 flex gap-3 bg-background py-3">
          {step > 0 ? (
            <Button variant="outline" onClick={() => setStep((s) => s - 1)}>
              <ArrowLeft className="size-4" /> {t("action.back")}
            </Button>
          ) : (
            <Button
              variant="ghost"
              className="text-muted-foreground"
              onClick={() => {
                clearOnboardingDraft();
                updateSettings({ onboarded: true });
                onDone();
              }}
            >
              {t("action.skip")}
            </Button>
          )}
          {step < STEPS.length - 1 ? (
            <Button className="flex-1" onClick={() => setStep((s) => s + 1)}>
              {t("action.next")} <ArrowRight className="size-4" />
            </Button>
          ) : (
            <Button className="flex-1" onClick={finish}>
              <Check className="size-4" /> {t("action.finish")}
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
