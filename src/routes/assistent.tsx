import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Mic, Send, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { languageLabel, useT } from "@/lib/i18n";
import { askAssistant } from "@/lib/ai.functions";
import { MONTHS_DE, shiftsInMonth, shiftsInYear } from "@/lib/minijob/calc";
import { payrollTotals } from "@/lib/minijob/payroll";
import { makeResolver } from "@/lib/minijob/resolve";
import { monthlyLimitOf, yearlyLimitOf } from "@/lib/minijob/limits";
import { useAppData } from "@/lib/minijob/store";
import { listenOnce, voiceSupported } from "@/lib/minijob/voice";

export const Route = createFileRoute("/assistent")({
  head: () => ({
    meta: [
      { title: "KI-Assistent – MiniJob Tracker" },
      {
        name: "description",
        content:
          "Frage den KI-Assistenten nach Arbeitsstunden, Verdienst, dem besten Monat, Prognosen und Mustern in deinen Arbeitszeiten.",
      },
      { property: "og:title", content: "KI-Assistent – MiniJob Tracker" },
      {
        property: "og:description",
        content: "Stunden, Verdienst, Prognosen und Arbeitsmuster per Frage analysieren.",
      },
    ],
  }),
  component: AssistantPage,
});

function AssistantPage() {
  const { t, lang } = useT();
  const data = useAppData();
  const call = useServerFn(askAssistant);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<{ role: "user" | "ai"; text: string }[]>([]);
  const [busy, setBusy] = useState(false);

  const SUGGESTIONS = [
    t("ai.suggestion.hours"),
    t("ai.suggestion.earnings"),
    t("ai.suggestion.bestMonth"),
    t("ai.suggestion.forecast"),
    t("ai.suggestion.patterns"),
  ];

  const context = useMemo(() => {
    const resolve = makeResolver(data.jobs, data.settings);
    const year = new Date().getFullYear();
    const months = MONTHS_DE.map((name, idx) => {
      const list = shiftsInMonth(data.shifts, year, idx);
      const totals = payrollTotals(list, resolve, data.shifts);
      return {
        monat: name,
        stunden: Number(totals.workedHours.toFixed(2)),
        verdienst: Number(totals.earnings.toFixed(2)),
        eintraege: list.length,
      };
    }).filter((m) => m.eintraege > 0);

    const perJob = data.jobs.map((job) => {
      const list = data.shifts.filter((s) => s.jobId === job.id);
      const totals = payrollTotals(list, resolve, data.shifts);
      return {
        job: job.name,
        stunden: Number(totals.workedHours.toFixed(2)),
        verdienst: Number(totals.earnings.toFixed(2)),
      };
    });

    const yearList = shiftsInYear(data.shifts, year);
    const yearTotals = payrollTotals(yearList, resolve, data.shifts);
    return JSON.stringify({
      jahr: year,
      heute: new Date().toISOString().slice(0, 10),
      monatsgrenze: monthlyLimitOf(data.settings, year, new Date().getMonth()),
      jahresgrenze: yearlyLimitOf(data.settings, year),
      jahresstunden: Number(yearTotals.workedHours.toFixed(2)),
      jahresverdienst: Number(yearTotals.earnings.toFixed(2)),
      monate: months,
      jobs: perJob,
    });
  }, [data]);

  async function ask(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    setMessages((m) => [...m, { role: "user", text: q }]);
    setQuestion("");
    setBusy(true);
    try {
      const result = await call({ data: { question: q, context, language: languageLabel(lang) } });
      setMessages((m) => [...m, { role: "ai", text: result.answer }]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("ai.error.generic"));
    } finally {
      setBusy(false);
    }
  }

  async function speak() {
    try {
      const text = await listenOnce();
      setQuestion(text);
    } catch {
      toast.error(t("ai.error.voice"));
    }
  }

  return (
    <main className="mx-auto max-w-lg px-4 pt-6">
      <h1 className="text-2xl font-extrabold tracking-tight">{t("ai.title")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("ai.intro")}</p>

      {messages.length === 0 ? (
        <div className="mt-5 space-y-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => ask(s)}
              className="flex w-full items-center gap-2 rounded-2xl border bg-card p-3 text-left text-sm shadow-card"
            >
              <Sparkles className="size-4 shrink-0 text-primary" />
              {s}
            </button>
          ))}
        </div>
      ) : (
        <div className="mt-5 space-y-3">
          {messages.map((m, i) => (
            <div
              key={i}
              className={
                m.role === "user"
                  ? "ml-auto max-w-[85%] rounded-2xl bg-primary px-4 py-2 text-sm text-primary-foreground"
                  : "mr-auto max-w-[90%] whitespace-pre-wrap rounded-2xl border bg-card px-4 py-2 text-sm shadow-card"
              }
            >
              {m.text}
            </div>
          ))}
          {busy ? <p className="text-xs text-muted-foreground">{t("ai.thinking")}</p> : null}
        </div>
      )}

      <div className="mt-5 flex items-end gap-2 pb-4">
        <Textarea
          rows={2}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={t("ai.placeholder")}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void ask(question);
            }
          }}
        />
        {voiceSupported() ? (
          <Button variant="outline" size="icon" onClick={speak} aria-label={t("ai.voiceInput")}>
            <Mic className="size-4" />
          </Button>
        ) : null}
        <Button size="icon" onClick={() => ask(question)} disabled={busy} aria-label={t("ai.send")}>
          <Send className="size-4" />
        </Button>
      </div>
    </main>
  );
}
