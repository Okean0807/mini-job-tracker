/**
 * Local-first AI conversation history, keyed by authenticated userId.
 * Survives reload / restart / re-login for the same user; never shared across users.
 * Cloud sync is intentionally out of scope (optional later).
 */

import type { AskSource } from "@/lib/ai/types";

export const AI_CHAT_HISTORY_KEY_PREFIX = "minijob-ai-chat-history-v1:";

/** Local-first history budgets prevent unbounded localStorage growth. */
export const AI_MAX_CONVERSATIONS = 50;
export const AI_MAX_MESSAGES_PER_CONVERSATION = 100;
export const AI_MAX_MESSAGE_CHARS = 8000;

export type AiChatRole = "user" | "ai";

export type AiChatMessage = {
  role: AiChatRole;
  text: string;
  sources?: AskSource[];
};

export type AiConversation = {
  id: string;
  /** Auto title from first user question (empty until first message). */
  title: string;
  messages: AiChatMessage[];
  createdAt: string;
  updatedAt: string;
};

export type AiChatHistoryStore = {
  conversations: AiConversation[];
  /** Active thread id, or null for a fresh empty draft. */
  activeId: string | null;
};

export function aiChatHistoryStorageKey(userId: string): string {
  return `${AI_CHAT_HISTORY_KEY_PREFIX}${userId}`;
}

export function emptyAiChatHistory(): AiChatHistoryStore {
  return { conversations: [], activeId: null };
}

export function newConversationId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Truncate first question into a list title. */
export function titleFromFirstQuestion(question: string, maxLen = 48): string {
  const cleaned = question.trim().replace(/\s+/g, " ");
  if (!cleaned) return "";
  if (cleaned.length <= maxLen) return cleaned;
  return `${cleaned.slice(0, Math.max(1, maxLen - 1)).trimEnd()}…`;
}

function isAskSource(value: unknown): value is AskSource {
  if (!value || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  return typeof o["url"] === "string" && o["url"].length > 0;
}

function normalizeMessage(raw: unknown): AiChatMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const role = o["role"];
  const text = o["text"];
  if (role !== "user" && role !== "ai") return null;
  if (typeof text !== "string") return null;
  const msg: AiChatMessage = { role, text: text.slice(0, AI_MAX_MESSAGE_CHARS) };
  const sources = o["sources"];
  if (Array.isArray(sources)) {
    const ok = sources.filter(isAskSource);
    if (ok.length > 0) msg.sources = ok;
  }
  return msg;
}

function normalizeConversation(raw: unknown): AiConversation | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = o["id"];
  const title = o["title"];
  const createdAt = o["createdAt"];
  const updatedAt = o["updatedAt"];
  const messagesRaw = o["messages"];
  if (typeof id !== "string" || !id) return null;
  if (typeof title !== "string") return null;
  if (typeof createdAt !== "string" || typeof updatedAt !== "string") return null;
  if (!Array.isArray(messagesRaw)) return null;
  const messages: AiChatMessage[] = [];
  for (const m of messagesRaw) {
    const n = normalizeMessage(m);
    if (n) messages.push(n);
  }
  return { id, title, messages, createdAt, updatedAt };
}

export function normalizeAiChatHistory(raw: unknown): AiChatHistoryStore {
  if (!raw || typeof raw !== "object") return emptyAiChatHistory();
  const o = raw as Record<string, unknown>;
  const listRaw = o["conversations"];
  const conversations: AiConversation[] = [];
  if (Array.isArray(listRaw)) {
    for (const c of listRaw) {
      const n = normalizeConversation(c);
      if (n) conversations.push(n);
    }
  }
  const activeIdRaw = o["activeId"];
  let activeId: string | null = null;
  if (typeof activeIdRaw === "string" && conversations.some((c) => c.id === activeIdRaw)) {
    activeId = activeIdRaw;
  } else if (conversations.length > 0) {
    const sorted = [...conversations].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    activeId = sorted[0]?.id ?? null;
  }
  const trimmed = conversations
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, AI_MAX_CONVERSATIONS)
    .map((conversation) => ({
      ...conversation,
      messages: conversation.messages.slice(-AI_MAX_MESSAGES_PER_CONVERSATION),
    }));
  const nextActiveId = activeId && trimmed.some((c) => c.id === activeId) ? activeId : trimmed[0]?.id ?? null;
  return { conversations: trimmed, activeId: nextActiveId };
}

export function loadAiChatHistory(userId: string): AiChatHistoryStore {
  if (!userId || typeof window === "undefined") return emptyAiChatHistory();
  try {
    const raw = window.localStorage.getItem(aiChatHistoryStorageKey(userId));
    if (!raw) return emptyAiChatHistory();
    return normalizeAiChatHistory(JSON.parse(raw) as unknown);
  } catch {
    return emptyAiChatHistory();
  }
}

export function saveAiChatHistory(userId: string, store: AiChatHistoryStore): void {
  if (!userId || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      aiChatHistoryStorageKey(userId),
      JSON.stringify(normalizeAiChatHistory(store)),
    );
  } catch {
    /* quota / private mode */
  }
}

/** Conversations newest-first for the history list. */
export function listConversationsNewestFirst(store: AiChatHistoryStore): AiConversation[] {
  return [...store.conversations].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getActiveConversation(store: AiChatHistoryStore): AiConversation | null {
  if (!store.activeId) return null;
  return store.conversations.find((c) => c.id === store.activeId) ?? null;
}

/** Start a blank draft (not yet persisted as a conversation until the first message). */
export function startNewConversation(store: AiChatHistoryStore): AiChatHistoryStore {
  return { ...store, activeId: null };
}

export function openConversation(store: AiChatHistoryStore, id: string): AiChatHistoryStore {
  if (!store.conversations.some((c) => c.id === id)) return store;
  return { ...store, activeId: id };
}

/**
 * Append / replace messages on the active conversation.
 * Creates a new conversation on the first user message of a draft.
 */
export function setActiveMessages(
  store: AiChatHistoryStore,
  messages: AiChatMessage[],
  now: Date = new Date(),
): AiChatHistoryStore {
  const iso = now.toISOString();
  const active = getActiveConversation(store);

  if (!active) {
    if (messages.length === 0) {
      return { ...store, activeId: null };
    }
    const firstUser = messages.find((m) => m.role === "user");
    const title = titleFromFirstQuestion(firstUser?.text ?? "");
    const created: AiConversation = {
      id: newConversationId(),
      title,
      messages,
      createdAt: iso,
      updatedAt: iso,
    };
    return {
      conversations: [created, ...store.conversations],
      activeId: created.id,
    };
  }

  const title =
    active.title ||
    titleFromFirstQuestion(messages.find((m) => m.role === "user")?.text ?? "");

  const updated: AiConversation = {
    ...active,
    title,
    messages,
    updatedAt: iso,
  };
  return {
    activeId: active.id,
    conversations: store.conversations.map((c) => (c.id === active.id ? updated : c)),
  };
}
