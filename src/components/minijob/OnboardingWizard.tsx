import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useAuthSession } from "@/hooks/use-auth-session";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { markWizardPendingFirstSync } from "@/lib/minijob/cloud";
import { signInWithOAuthProvider } from "@/lib/minijob/oauth-sign-in";
import {
  checkpointOnboardingBeforeOAuth,
  clearOnboardingDraft,
  loadOnboardingDraft,
  persistOnboardingProgress,
} from "@/lib/minijob/onboarding-draft";
import { LANGUAGES } from "@/lib/i18n/core";
import { useT } from "@/lib/i18n";
import { weekdayNames } from "@/lib/minijob/calc";
import { weeklyPlanHours } from "@/lib/minijob/schedule";
import { newId, nextJobColor, saveJob, updateSettings } from "@/lib/minijob/store";
import {
  BUNDESLAENDER,
  COUNTRIES,
  DEFAULT_SUPPLEMENTS,
  EMPTY_WEEK,
  WORK_MODE_LABEL,
  type FixedDay,
  type Job,
  type Settings,
  type Supplement,
  type Supplements,
  type WorkMode,
} from "@/lib/minijob/types";
import {
  WIZARD_STEP_COUNT,
  WIZARD_STEP_INDEX,
  canAdvancePastCloud,
  oauthResumeStep,
  resolveWizardResumeStep,
} from "@/lib/minijob/wizard-flow";
import { cn } from "@/lib/utils";

interface Props {
  settings: Settings;
  onDone: () => void;
}

export function OnboardingWizard({ settings, onDone }: Props) {
  const { t, locale } = useT();
  // Step labels depend on workMode (SELF: Tätigkeit instead of Stundenlohn).
  const WORK_MODE_KEY: Record<WorkMode, string> = {
    flex: "mode.flex",
    fest: "mode.fest",
    selbststaendig: "mode.selbststaendig",
  };

  // Resume after OAuth / incomplete wizard (draft in localStorage; settings from store).
  const { status: authStatus, session } = useAuthSession();
  const [draft] = useState(() => loadOnboardingDraft(WIZARD_STEP_COUNT));
  const [step, setStep] = useState(() =>
    resolveWizardResumeStep(draft?.step, "loading"),
  );
  const [mode, setMode] = useState<WorkMode>(draft?.mode ?? "flex");

  const localDemoMode = settings.localDemoMode === true;
  const STEPS = [
    t("wiz.step.welcome"),
    t("wiz.step.cloud"),
    t("wiz.step.workMode"),
    t("wiz.step.region"),
    mode === "selbststaendig" ? t("wiz.step.activity") : t("wiz.step.rate"),
    t("wiz.step.personalized"),
    t("wiz.step.firstJob"),
  ];

  // After Google: Cloud → Work Mode. Signed-out: cannot stay past Cloud (unless demo).
  useEffect(() => {
    if (authStatus === "loading") return;
    setStep((current) => {
      const resolved = resolveWizardResumeStep(current, authStatus, {
        localDemoMode,
      });
      if (resolved !== current) {
        persistOnboardingProgress({
          step: resolved,
          mode,
          persistSettings: () => {
            /* settings already in store; step/mode draft only */
          },
        });
      }
      return resolved;
    });
  }, [authStatus, mode, localDemoMode]);
  const [country, setCountry] = useState(settings.country);
  const [bundesland, setBundesland] = useState(settings.bundesland);
  const [rate, setRate] = useState(String(settings.defaultRate));
  const [supplements, setSupplements] = useState<Supplements>(settings.supplements ?? DEFAULT_SUPPLEMENTS);
  const [week, setWeek] = useState<FixedDay[]>(() => EMPTY_WEEK.map((d) => ({ ...d })));
  const [weeklyTarget, setWeeklyTarget] = useState("20");
  const [weeklyTargetTouched, setWeeklyTargetTouched] = useState(false);
  const [payType, setPayType] = useState<"monthly" | "hourly">("hourly");
  const [monthlyGross, setMonthlyGross] = useState("");
  const [jobName, setJobName] = useState("");
  const [employer, setEmployer] = useState("");
  const [activity, setActivity] = useState("");
  const [location, setLocation] = useState("");

  const numericRate = Number(rate.replace(",", ".")) || 0;
  const plannedWeekly = useMemo(
    () =>
      weeklyPlanHours({
        id: "tmp",
        name: "tmp",
        color: "#000",
        mode: "fest",
        week,
      }),
    [week],
  );

  useEffect(() => {
    if (!weeklyTargetTouched) setWeeklyTarget(String(plannedWeekly || 20));
  }, [plannedWeekly, weeklyTargetTouched]);

  function flushSettings() {
    updateSettings({
      country,
      bundesland,
      defaultRate: numericRate,
      supplements,
    });
  }

  function persistProgress(atStep: number, atMode: WorkMode = mode) {
    persistOnboardingProgress({
      step: atStep,
      mode: atMode,
      persistSettings: flushSettings,
    });
  }

  function goNext() {
    // Google required before later steps — unless local demo mode.
    if (
      step === WIZARD_STEP_INDEX.cloud &&
      !canAdvancePastCloud(authStatus, localDemoMode)
    ) {
      toast.error(t("wiz.cloud.required"));
      return;
    }
    const next = Math.min(step + 1, STEPS.length - 1);
    persistProgress(next);
    setStep(next);
  }

  /** Local demo: no Google, no fake session — on-device store only. */
  function startLocalDemo() {
    updateSettings({ localDemoMode: true });
    const next = WIZARD_STEP_INDEX.workMode;
    persistOnboardingProgress({
      step: next,
      mode,
      persistSettings: flushSettings,
    });
    setStep(next);
  }

  function goBack() {
    const prev = Math.max(step - 1, 0);
    // Keep all entered data; only move the index.
    persistProgress(prev);
    setStep(prev);
  }

  function selectMode(m: WorkMode) {
    // Never wipe region/rate/supplements/week when switching modes.
    setMode(m);
    persistProgress(step, m);
  }

  function finish() {
    const name = jobName.trim();
    if (!name) {
      toast.error(t("job.errorName"));
      return;
    }
    clearOnboardingDraft();
    updateSettings({
      country,
      bundesland,
      defaultRate: numericRate,
      supplements,
      onboarded: true,
      wizardCompletedAt: Date.now(),
    });
    if (name) {
      // Avoid false FIRST_SYNC jobs conflict if sync races finish before lastSyncedAt.
      markWizardPendingFirstSync();
      const job: Job = {
        id: newId(),
        name,
        color: nextJobColor(),
        // SELF: no Pflicht-Stundenlohn. FEST monthly: rate optional (monthlyGross primary).
        ...(mode !== "selbststaendig" && !(mode === "fest" && payType === "monthly")
          ? { rate: numericRate }
          : {}),
        mode,
        ...(employer.trim() ? { employer: employer.trim() } : {}),
        supplements,
      };
      if (mode === "fest") {
        job.week = week.map((d) => ({ ...d }));
        const planned = weeklyPlanHours(job);
        job.weeklyTarget = Number(weeklyTarget.replace(",", ".")) || planned || 20;
        job.payType = payType;
        if (payType === "monthly") {
          const gross = Number(monthlyGross.replace(",", ".")) || 0;
          if (gross > 0) job.monthlyGross = gross;
        }
      }
      if (mode === "selbststaendig") {
        if (activity.trim()) job.notes = activity.trim();
        if (location.trim()) job.address = location.trim();
      }
      saveJob(job);
    }
    toast.success(t("wiz.toast.done"));
    onDone();
  }

  async function oauth() {
    // Choosing real Google exits demo — do not treat demo as a cloud account.
    if (localDemoMode) {
      updateSettings({ localDemoMode: false });
    }
    // Persist language/region/rate/supplements + resume at Work Mode after Google returns.
    checkpointOnboardingBeforeOAuth({
      step: oauthResumeStep(),
      mode,
      persistSettings: flushSettings,
    });
    try {
      const { error } = await signInWithOAuthProvider("google");
      if (error) toast.error(t("error.signIn"));
    } catch {
      toast.error(t("error.signIn"));
    }
  }

  const weekdays = weekdayNames(locale, "short");

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-background">
      <div className="mx-auto flex min-h-[100dvh] max-w-lg flex-col px-4 pt-6 pb-0">
        <header className="shrink-0">
          <p className="text-xs font-medium text-muted-foreground">
            {t("wiz.stepOf", { current: step + 1, total: STEPS.length, step: STEPS[step] ?? "" })}
          </p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight">
            {step === WIZARD_STEP_INDEX.welcome ? t("wiz.welcome.title") : t("wiz.title")}
          </h1>
          <div className="mt-3 flex gap-1" aria-hidden>
            {STEPS.map((s, i) => (
              <span
                key={`${s}-${i}`}
                className={cn("h-1.5 flex-1 rounded-full", i <= step ? "bg-primary" : "bg-muted")}
              />
            ))}
          </div>
          {localDemoMode ? (
            <p
              className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-900 dark:text-amber-100"
              role="status"
            >
              {t("wiz.demo.banner")}
            </p>
          ) : null}
        </header>

        <div className="mt-6 flex-1 space-y-4 pb-4">
          {step === WIZARD_STEP_INDEX.welcome ? (
            <Card title={t("wiz.welcome.cardTitle")} hint={t("wiz.welcome.body")}>
              <p className="text-sm font-semibold">{t("wiz.language.select")}</p>
              <FieldHelp>{t("wiz.language.hint")}</FieldHelp>
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

          {step === WIZARD_STEP_INDEX.cloud ? (
            <Card title={t("wiz.cloud.title")} hint={t("wiz.cloud.hint")}>
              {authStatus === "loading" ? (
                <div aria-busy="true" aria-label="loading" className="space-y-2 py-2">
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : authStatus === "signed_in" ? (
                <p className="text-sm text-muted-foreground">
                  {t("set.account.cloud.signedInAs", {
                    email: session?.user.email ?? "",
                  })}
                </p>
              ) : (
                <>
                  <Button className="min-h-11 w-full" onClick={() => oauth()}>
                    {t("wiz.cloud.google")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11 w-full"
                    onClick={() => startLocalDemo()}
                  >
                    {t("wiz.cloud.demoTest")}
                  </Button>
                  <FieldHelp>{t("wiz.cloud.demoHint")}</FieldHelp>
                  <FieldHelp>{t("wiz.cloud.requiredHint")}</FieldHelp>
                </>
              )}
            </Card>
          ) : null}

          {step === WIZARD_STEP_INDEX.workMode ? (
            <Card title={t("wiz.workMode.title")} hint={t("wiz.workMode.hint")}>
              <FieldHelp>{t("wiz.help.workMode")}</FieldHelp>
              {(Object.keys(WORK_MODE_LABEL) as WorkMode[]).map((m) => (
                <Choice
                  key={m}
                  label={t(WORK_MODE_KEY[m])}
                  hint={t(`wiz.workMode.explain.${m}`)}
                  active={mode === m}
                  onClick={() => selectMode(m)}
                />
              ))}
            </Card>
          ) : null}

          {step === WIZARD_STEP_INDEX.region ? (
            <Card title={t("wiz.region.title")} hint={t("wiz.region.hint")}>
              <div className="grid gap-2">
                <Label htmlFor="ob-land">{t("wiz.region.country")}</Label>
                <select
                  id="ob-land"
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  className="h-11 rounded-md border bg-background px-2 text-sm"
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
                    className="h-11 rounded-md border bg-background px-2 text-sm"
                  >
                    {BUNDESLAENDER.map((b) => (
                      <option key={b.code} value={b.code}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                  <FieldHelp>{t("wiz.help.absence")}</FieldHelp>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">{t("wiz.region.noStateHint")}</p>
              )}
            </Card>
          ) : null}

          {step === WIZARD_STEP_INDEX.rate ? (
            mode === "selbststaendig" ? (
              <Card title={t("wiz.rate.self.title")} hint={t("wiz.rate.self.hint")}>
                <div className="grid gap-2">
                  <Label htmlFor="ob-activity">{t("wiz.rate.self.label")}</Label>
                  <Input
                    id="ob-activity"
                    className="min-h-11"
                    value={jobName}
                    placeholder={t("wiz.rate.self.placeholder")}
                    onChange={(e) => setJobName(e.target.value)}
                  />
                  <FieldHelp>{t("wiz.help.selfActivity")}</FieldHelp>
                </div>
                <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                  {t("wiz.personalized.self.noLimit")}
                </p>
                <FieldHelp>{t("wiz.help.tax")}</FieldHelp>
              </Card>
            ) : mode === "fest" ? (
              <Card title={t("wiz.rate.title")} hint={t("wiz.personalized.fest.payHint")}>
                <div className="grid gap-2">
                  <Label>{t("job.payType")}</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {(["hourly", "monthly"] as const).map((pt) => (
                      <button
                        key={pt}
                        type="button"
                        onClick={() => setPayType(pt)}
                        className={cn(
                          "min-h-11 rounded-xl border px-3 py-2 text-sm",
                          payType === pt ? "border-primary bg-primary/10 font-semibold" : "bg-card",
                        )}
                      >
                        {t(pt === "hourly" ? "job.payTypeHourly" : "job.payTypeMonthly")}
                      </button>
                    ))}
                  </div>
                  <FieldHelp>{t("job.help.payType")}</FieldHelp>
                </div>
                {payType === "hourly" ? (
                  <div className="grid gap-2">
                    <Label htmlFor="ob-rate">{t("wiz.rate.label")}</Label>
                    <Input
                      id="ob-rate"
                      type="number"
                      inputMode="decimal"
                      step="0.5"
                      min="0"
                      className="min-h-11"
                      value={rate}
                      onChange={(e) => setRate(e.target.value)}
                    />
                    <FieldHelp>{t("wiz.help.rate")}</FieldHelp>
                  </div>
                ) : (
                  <div className="grid gap-2">
                    <Label htmlFor="ob-monthly">{t("job.monthlyGross")}</Label>
                    <Input
                      id="ob-monthly"
                      type="number"
                      inputMode="decimal"
                      step="1"
                      min="0"
                      className="min-h-11"
                      value={monthlyGross}
                      onChange={(e) => setMonthlyGross(e.target.value)}
                    />
                    <FieldHelp>{t("job.help.monthlyGross")}</FieldHelp>
                  </div>
                )}
                <FieldHelp>{t("job.help.arbeitszeitkonto")}</FieldHelp>
                <FieldHelp>{t("wiz.help.tax")}</FieldHelp>
              </Card>
            ) : (
              <Card title={t("wiz.rate.title")} hint={t("wiz.rate.hint")}>
                <div className="grid gap-2">
                  <Label htmlFor="ob-rate">{t("wiz.rate.label")}</Label>
                  <Input
                    id="ob-rate"
                    type="number"
                    inputMode="decimal"
                    step="0.5"
                    min="0"
                    className="min-h-11"
                    value={rate}
                    onChange={(e) => setRate(e.target.value)}
                  />
                  <FieldHelp>{t("wiz.help.rate")}</FieldHelp>
                </div>
                <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                  {t("wiz.help.monthLimit")}
                </p>
                <FieldHelp>{t("wiz.help.tax")}</FieldHelp>
              </Card>
            )
          ) : null}

          {step === WIZARD_STEP_INDEX.personalized ? (
            mode === "fest" ? (
              <Card title={t("wiz.personalized.fest.title")} hint={t("wiz.personalized.fest.hint")}>
                <div className="space-y-3">
                  {week.map((day, idx) => (
                    <div key={weekdays[idx]} className="space-y-2 rounded-xl border p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">{weekdays[idx]}</span>
                        <Switch
                          checked={day.active}
                          onCheckedChange={(checked) =>
                            setWeek(week.map((d, i) => (i === idx ? { ...d, active: checked } : d)))
                          }
                          aria-label={weekdays[idx]}
                        />
                      </div>
                      {day.active ? (
                        <div className="grid grid-cols-3 gap-2">
                          <div className="grid gap-1">
                            <Label className="text-xs">{t("wiz.help.startLabel")}</Label>
                            <Input
                              type="time"
                              className="min-h-11"
                              value={day.start}
                              onChange={(e) =>
                                setWeek(
                                  week.map((d, i) => (i === idx ? { ...d, start: e.target.value } : d)),
                                )
                              }
                            />
                          </div>
                          <div className="grid gap-1">
                            <Label className="text-xs">{t("wiz.help.endLabel")}</Label>
                            <Input
                              type="time"
                              className="min-h-11"
                              value={day.end}
                              onChange={(e) =>
                                setWeek(
                                  week.map((d, i) => (i === idx ? { ...d, end: e.target.value } : d)),
                                )
                              }
                            />
                          </div>
                          <div className="grid gap-1">
                            <Label className="text-xs">{t("wiz.help.breakLabel")}</Label>
                            <Input
                              type="number"
                              inputMode="numeric"
                              className="min-h-11"
                              value={day.breakMinutes}
                              onChange={(e) =>
                                setWeek(
                                  week.map((d, i) =>
                                    i === idx
                                      ? { ...d, breakMinutes: Number(e.target.value) || 0 }
                                      : d,
                                  ),
                                )
                              }
                            />
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ))}
                  <FieldHelp>{t("wiz.help.startEnd")}</FieldHelp>
                  <FieldHelp>{t("wiz.help.break")}</FieldHelp>
                  <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                    {t("job.help.wochenstunden")} · {plannedWeekly.toFixed(1)} h
                  </p>
                  <FieldHelp>{t("job.help.sollzeit")}</FieldHelp>
                  <FieldHelp>{t("job.help.istzeit")}</FieldHelp>
                  <FieldHelp>{t("job.help.arbeitszeitkonto")}</FieldHelp>
                  <div className="grid gap-2">
                    <Label htmlFor="ob-weekly">{t("wiz.personalized.fest.weeklyTarget")}</Label>
                    <Input
                      id="ob-weekly"
                      type="number"
                      inputMode="decimal"
                      className="min-h-11"
                      value={weeklyTarget}
                      onChange={(e) => {
                        setWeeklyTargetTouched(true);
                        setWeeklyTarget(e.target.value);
                      }}
                    />
                    <FieldHelp>{t("wiz.personalized.fest.weeklyTargetHint")}</FieldHelp>
                  </div>
                </div>
              </Card>
            ) : mode === "selbststaendig" ? (
              <Card title={t("wiz.personalized.self.title")} hint={t("wiz.personalized.self.hint")}>
                <p className="rounded-lg border border-dashed px-3 py-3 text-sm">
                  {t("wiz.personalized.self.noLimit")}
                </p>
                <p className="text-sm text-muted-foreground">{t("wiz.personalized.self.projects")}</p>
                <FieldHelp>{t("wiz.help.tax")}</FieldHelp>
              </Card>
            ) : (
              <Card title={t("wiz.personalized.flex.title")} hint={t("wiz.personalized.flex.hint")}>
                <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                  {t("wiz.help.monthLimit")}
                </p>
                <FieldHelp>{t("wiz.help.supplements")}</FieldHelp>
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
                        className="min-h-11 w-20"
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
            )
          ) : null}

          {step === WIZARD_STEP_INDEX.firstJob ? (
            <Card
              title={
                mode === "selbststaendig" ? t("wiz.firstJob.selfTitle") : t("wiz.firstJob.title")
              }
              hint={
                mode === "selbststaendig" ? t("wiz.firstJob.selfHint") : t("wiz.firstJob.hint")
              }
            >
              <div className="grid gap-2">
                <Label htmlFor="ob-job">
                  {mode === "selbststaendig" ? t("wiz.firstJob.project") : t("wiz.firstJob.name")}
                </Label>
                <Input
                  id="ob-job"
                  className="min-h-11"
                  value={jobName}
                  placeholder={
                    mode === "selbststaendig"
                      ? t("wiz.firstJob.projectPlaceholder")
                      : t("wiz.firstJob.namePlaceholder")
                  }
                  onChange={(e) => setJobName(e.target.value)}
                />
              </div>
              {mode === "selbststaendig" ? (
                <>
                  <div className="grid gap-2">
                    <Label htmlFor="ob-act">{t("wiz.firstJob.activity")}</Label>
                    <Input
                      id="ob-act"
                      className="min-h-11"
                      value={activity}
                      onChange={(e) => setActivity(e.target.value)}
                    />
                    <FieldHelp>{t("wiz.help.activity")}</FieldHelp>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="ob-loc">{t("wiz.firstJob.location")}</Label>
                    <Input
                      id="ob-loc"
                      className="min-h-11"
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                    />
                    <FieldHelp>{t("wiz.help.location")}</FieldHelp>
                  </div>
                </>
              ) : (
                <div className="grid gap-2">
                  <Label htmlFor="ob-emp">{t("wiz.firstJob.employer")}</Label>
                  <Input
                    id="ob-emp"
                    className="min-h-11"
                    value={employer}
                    onChange={(e) => setEmployer(e.target.value)}
                  />
                  <FieldHelp>{t("wiz.help.employer")}</FieldHelp>
                </div>
              )}
            </Card>
          ) : null}
        </div>

        <footer
          className="sticky bottom-0 z-10 mt-auto flex gap-3 border-t bg-background/95 pt-3 backdrop-blur supports-[backdrop-filter]:bg-background/80"
          style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom, 0px))" }}
        >
          {step > 0 ? (
            <Button
              variant="outline"
              className="min-h-11 shrink-0 px-4"
              onClick={goBack}
              aria-label={t("action.back")}
            >
              <ArrowLeft className="size-4" /> {t("action.back")}
            </Button>
          ) : (
            // No Skip on Welcome: marking onboarded here sent new users to Dashboard
            // before Google + Work Mode + personalized steps (Batch #85 regression).
            <span className="inline-block min-h-11 min-w-11 shrink-0" aria-hidden />
          )}
          {step < STEPS.length - 1 ? (
            <Button
              className="min-h-11 flex-1"
              onClick={goNext}
              disabled={step === WIZARD_STEP_INDEX.cloud && authStatus === "loading"}
            >
              {t("action.next")} <ArrowRight className="size-4" />
            </Button>
          ) : (
            <Button className="min-h-11 flex-1" onClick={finish} disabled={!jobName.trim()}>
              <Check className="size-4" /> {t("action.finish")}
            </Button>
          )}
        </footer>
      </div>
    </div>
  );
}

function FieldHelp({ children }: { children: React.ReactNode }) {
  return <p className="text-xs leading-snug text-muted-foreground">{children}</p>;
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
  hint,
  active,
  onClick,
}: {
  label: string;
  hint?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "min-h-11 w-full rounded-xl border px-4 py-3 text-left text-sm font-medium",
        active ? "border-primary bg-primary/10" : "bg-background",
      )}
    >
      <span className="block">{label}</span>
      {hint ? <span className="mt-1 block text-xs font-normal text-muted-foreground">{hint}</span> : null}
    </button>
  );
}
