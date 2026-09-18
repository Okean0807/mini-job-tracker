import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { History, Mic, Plus, Send, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useAuthSession } from "@/hooks/use-auth-session";
import { sourceDisplayLabel } from "@/lib/ai/sources";
import type { AskSource } from "@/lib/ai/types";
import { ASK_CLIENT_TIMEOUT_MS, runAssistantAsk } from "@/lib/ai-ask";
import { aiClientErrorMessage } from "@/lib/ai-client-error";
import { askAssistant } from "@/lib/ai.functions";
import { languageLabel, useT } from "@/lib/i18n";
import {
  type AiChatHistoryStore,
  type AiChatMessage,
  getActiveConversation,
  listConversationsNewestFirst,
  loadAiChatHistory,
  openConversation,
  saveAiChatHistory,
  setActiveMessages,
  startNewConversation,
} from "@/lib/minijob/ai-chat-history";
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

type ChatMessage = AiChatMessage;

function formatConversationWhen(iso: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function AssistantPage() {
  const { t, lang, locale } = useT();
  const { status: authStatus, session } = useAuthSession();
  const userId = session?.user?.id ?? null;
  const call = useServerFn(askAssistant);
  const [question, setQuestion] = useState("");
  const [history, setHistory] = useState<AiChatHistoryStore>(() => ({
    conversations: [],
    activeId: null,
  }));
  const [busy, setBusy] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Load per-user history when signed in (isolation by userId key).
  useEffect(() => {
    if (authStatus !== "signed_in" || !userId) {
      setHistory({ conversations: [], activeId: null });
      return;
    }
    setHistory(loadAiChatHistory(userId));
  }, [authStatus, userId]);

  const persistHistory = useCallback(
    (next: AiChatHistoryStore) => {
      setHistory(next);
      if (userId) saveAiChatHistory(userId, next);
    },
    [userId],
  );

  const messages: ChatMessage[] = useMemo(() => {
    const active = getActiveConversation(history);
    return active?.messages ?? [];
  }, [history]);

  const listed = useMemo(() => listConversationsNewestFirst(history), [history]);

  const SUGGESTIONS = [
    t("ai.suggestion.hours"),
    t("ai.suggestion.earnings"),
    t("ai.suggestion.bestMonth"),
    t("ai.suggestion.forecast"),
    t("ai.suggestion.patterns"),
  ];

  function applyMessages(nextMessages: ChatMessage[]) {
    persistHistory(setActiveMessages(history, nextMessages));
  }

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
    const withUser: ChatMessage[] = [...messages, { role: "user", text: q }];
    applyMessages(withUser);
    setQuestion("");
    // runAssistantAsk always clears busy (timeout/rejection) — never leave «denkt nach».
    await runAssistantAsk(
      () => call({ data: { question: q, context, language: languageLabel(lang) } }),
      {
        setBusy,
        onAnswer: (result) => {
          const msg: ChatMessage = { role: "ai", text: result.answer };
          if (result.sources && result.sources.length > 0) {
            msg.sources = result.sources;
          }
          setHistory((prev) => {
            const base = getActiveConversation(prev)?.messages ?? withUser;
            const prior = base.length >= withUser.length ? base : withUser;
            const next = setActiveMessages(prev, [...prior, msg]);
            if (userId) saveAiChatHistory(userId, next);
            return next;
          });
        },
        onError: (message) => {
          toast.error(message);
          // Persist sanitized error into chat (never raw Failed to fetch).
          setHistory((prev) => {
            const base = getActiveConversation(prev)?.messages ?? withUser;
            const prior = base.length >= withUser.length ? base : withUser;
            const next = setActiveMessages(prev, [
              ...prior,
              { role: "ai", text: message },
            ]);
            if (userId) saveAiChatHistory(userId, next);
            return next;
          });
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

  function onNewChat() {
    persistHistory(startNewConversation(history));
    setHistoryOpen(false);
  }

  function onOpenChat(id: string) {
    persistHistory(openConversation(history, id));
    setHistoryOpen(false);
  }

  return (
    <main className="mx-auto max-w-lg px-4 pt-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold tracking-tight">{t("ai.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("ai.intro")}</p>
        </div>
        {authStatus === "signed_in" ? (
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onNewChat}
              disabled={busy || messages.length === 0}
              aria-label={t("ai.history.new")}
            >
              <Plus className="size-4" />
              <span className="sr-only sm:not-sr-only sm:ml-1">{t("ai.history.new")}</span>
            </Button>
            <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
              <SheetTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={t("ai.history.open")}
                >
                  <History className="size-4" />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-full max-w-sm">
                <SheetHeader>
                  <SheetTitle>{t("ai.history.title")}</SheetTitle>
                </SheetHeader>
                <div className="mt-4 space-y-3">
                  <Button type="button" className="w-full" onClick={onNewChat} disabled={busy}>
                    {t("ai.history.new")}
                  </Button>
                  {listed.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t("ai.history.empty")}</p>
                  ) : (
                    <ul className="space-y-2">
                      {listed.map((c) => {
                        const isCurrent = c.id === history.activeId;
                        return (
                          <li key={c.id}>
                            <button
                              type="button"
                              onClick={() => onOpenChat(c.id)}
                              className={
                                isCurrent
                                  ? "w-full rounded-2xl border-2 border-primary bg-primary/5 p-3 text-left shadow-card"
                                  : "w-full rounded-2xl border bg-card p-3 text-left shadow-card"
                              }
                            >
                              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                                <span>{formatConversationWhen(c.updatedAt, locale)}</span>
                                {isCurrent ? (
                                  <span className="font-medium text-primary">
                                    {t("ai.history.current")}
                                  </span>
                                ) : (
                                  <span>{t("ai.history.past")}</span>
                                )}
                              </div>
                              <p className="mt-1 line-clamp-2 text-sm font-medium">
                                {c.title || t("ai.history.untitled")}
                              </p>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </SheetContent>
            </Sheet>
          </div>
        ) : null}
      </div>

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
                        {m.sources.map((s: AskSource) => (
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
            <Button
              size="icon"
              onClick={() => ask(question)}
              disabled={busy}
              aria-label={t("ai.send")}
            >
              <Send className="size-4" />
            </Button>
          </div>
        </>
      )}
    </main>
  );
}
