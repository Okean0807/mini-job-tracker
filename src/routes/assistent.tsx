import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Mic, Send, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useAuthSession } from "@/hooks/use-auth-session";
import { sourceDisplayLabel } from "@/lib/ai/sources";
import type { AskSource } from "@/lib/ai/types";
import { ASK_CLIENT_TIMEOUT_MS, runAssistantAsk } from "@/lib/ai-ask";
import { aiClientErrorMessage } from "@/lib/ai-client-error";
import { askAssistant } from "@/lib/ai.functions";
import { languageLabel, useT } from "@/lib/i18n";
import { buildAssistantContext } from "@/lib/minijob/ai-context";
import { getData } from "@/lib/minijob/store";
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

type ChatMessage = {
  role: "user" | "ai";
  text: string;
  sources?: AskSource[];
};

function AssistantPage() {
  const { t, lang } = useT();
  const { status: authStatus } = useAuthSession();
  const call = useServerFn(askAssistant);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);

  const SUGGESTIONS = [
    t("ai.suggestion.hours"),
    t("ai.suggestion.earnings"),
    t("ai.suggestion.bestMonth"),
    t("ai.suggestion.forecast"),
    t("ai.suggestion.patterns"),
  ];

  async function ask(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    if (authStatus !== "signed_in") {
      toast.error(t("ai.signedOut"));
      return;
    }
    // Fresh snapshot at click time — avoids stale useMemo closures and makes
    // currentMonth / hourlyRate / limits explicit for Gemini.
    const context = buildAssistantContext(getData());
    setMessages((m) => [...m, { role: "user", text: q }]);
    setQuestion("");
    // runAssistantAsk always clears busy (timeout/rejection) — never leave «denkt nach».
    await runAssistantAsk(
      () => call({ data: { question: q, context, language: languageLabel(lang) } }),
      {
        setBusy,
        onAnswer: (result) =>
          setMessages((m) => {
            const msg: ChatMessage = { role: "ai", text: result.answer };
            if (result.sources && result.sources.length > 0) {
              msg.sources = result.sources;
            }
            return [...m, msg];
          }),
        onError: (message) => {
          toast.error(message);
          setMessages((m) => [...m, { role: "ai", text: message }]);
        },
      },
      {
        timeoutMs: ASK_CLIENT_TIMEOUT_MS,
        mapError: (error) => aiClientErrorMessage(error, t("ai.error.generic")),
        timeoutMessage: t("ai.error.timeout"),
      },
    );
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

      {authStatus === "loading" ? (
        <div
          className="mt-6 rounded-2xl border border-dashed p-8"
          aria-busy="true"
          aria-label="loading"
        >
          <Skeleton className="mx-auto h-4 w-56" />
          <Skeleton className="mx-auto mt-3 h-4 w-40" />
        </div>
      ) : authStatus === "signed_out" ? (
        <div className="mt-6 rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          {t("ai.signedOut")}
        </div>
      ) : (
        <>
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
                  {m.role === "ai" && m.sources && m.sources.length > 0 ? (
                    <div className="mt-2 border-t border-border/60 pt-2 text-xs text-muted-foreground">
                      <span className="font-medium">{t("ai.sources")}</span>
                      <ul className="mt-1 space-y-0.5">
                        {m.sources.map((s) => (
                          <li key={s.url}>
                            <a
                              href={s.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="underline underline-offset-2 hover:text-foreground"
                            >
                              {sourceDisplayLabel(s)}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
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
        </>
      )}
    </main>
  );
}
