import { afterEach, describe, expect, it } from "vitest";

import {
  aiChatHistoryStorageKey,
  emptyAiChatHistory,
  listConversationsNewestFirst,
  loadAiChatHistory,
  openConversation,
  saveAiChatHistory,
  setActiveMessages,
  startNewConversation,
  titleFromFirstQuestion,
} from "./ai-chat-history";

describe("ai-chat-history", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("titles from first question and truncates", () => {
    expect(titleFromFirstQuestion("Analysiere meine Arbeitsmuster.")).toBe(
      "Analysiere meine Arbeitsmuster.",
    );
    const long = "A".repeat(60);
    expect(titleFromFirstQuestion(long).endsWith("…")).toBe(true);
    expect(titleFromFirstQuestion(long).length).toBeLessThanOrEqual(48);
  });

  it("persists and reloads conversations for the same userId", () => {
    const userId = "user-a";
    let store = emptyAiChatHistory();
    store = setActiveMessages(store, [
      { role: "user", text: "Analysiere meine Arbeitsmuster." },
      { role: "ai", text: "Du arbeitest oft am Wochenende." },
    ]);
    saveAiChatHistory(userId, store);

    const loaded = loadAiChatHistory(userId);
    expect(loaded.conversations).toHaveLength(1);
    expect(loaded.conversations[0]?.title).toBe("Analysiere meine Arbeitsmuster.");
    expect(loaded.conversations[0]?.messages).toHaveLength(2);
    expect(loaded.activeId).toBe(loaded.conversations[0]?.id);
  });

  it("isolates history by userId (user A never sees user B)", () => {
    let a = emptyAiChatHistory();
    a = setActiveMessages(a, [{ role: "user", text: "Frage von A" }, { role: "ai", text: "Antwort A" }]);
    saveAiChatHistory("user-a", a);

    let b = emptyAiChatHistory();
    b = setActiveMessages(b, [{ role: "user", text: "Frage von B" }, { role: "ai", text: "Antwort B" }]);
    saveAiChatHistory("user-b", b);

    expect(aiChatHistoryStorageKey("user-a")).not.toBe(aiChatHistoryStorageKey("user-b"));
    expect(loadAiChatHistory("user-a").conversations[0]?.title).toBe("Frage von A");
    expect(loadAiChatHistory("user-b").conversations[0]?.title).toBe("Frage von B");
    expect(loadAiChatHistory("user-a").conversations[0]?.messages[0]?.text).not.toContain("Frage von B");
  });

  it("supports new chat and opening an existing conversation", () => {
    let store = emptyAiChatHistory();
    store = setActiveMessages(store, [
      { role: "user", text: "Erste Frage" },
      { role: "ai", text: "Erste Antwort" },
    ]);
    const firstId = store.activeId!;
    store = startNewConversation(store);
    expect(store.activeId).toBeNull();
    store = setActiveMessages(store, [
      { role: "user", text: "Zweite Frage" },
      { role: "ai", text: "Zweite Antwort" },
    ]);
    expect(store.conversations).toHaveLength(2);
    const listed = listConversationsNewestFirst(store);
    expect(listed[0]?.title).toBe("Zweite Frage");

    store = openConversation(store, firstId);
    expect(store.activeId).toBe(firstId);
    expect(store.conversations.find((c) => c.id === firstId)?.messages[0]?.text).toBe("Erste Frage");
  });

  it("survives re-login simulation (reload from localStorage for same user)", () => {
    const userId = "relogin-user";
    let store = emptyAiChatHistory();
    store = setActiveMessages(store, [{ role: "user", text: "Bleibt erhalten" }, { role: "ai", text: "Ja" }]);
    saveAiChatHistory(userId, store);

    // Simulate fresh page load / re-login same user
    const again = loadAiChatHistory(userId);
    expect(again.conversations).toHaveLength(1);
    expect(again.conversations[0]?.title).toBe("Bleibt erhalten");
  });
});
