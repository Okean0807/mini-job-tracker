/**
 * Per-user acknowledgement of the notice shown before the first AI request
 * (question + app context go to external providers). Stored locally only.
 *
 * The key ends with `:u:<userId>`, so `clearUserScopeLocalData` removes it on account deletion.
 * Changing the notice substantially? Bump the version in the key to ask again.
 */
export const AI_NOTICE_KEY_BASE = "minijob-ai-notice-ack-v1";

export function aiNoticeStorageKey(userId: string): string {
  return `${AI_NOTICE_KEY_BASE}:u:${userId}`;
}

export function hasAcknowledgedAiNotice(userId: string): boolean {
  if (!userId || typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(aiNoticeStorageKey(userId)) !== null;
  } catch {
    return false;
  }
}

/** Returns false when the choice could not be persisted (the caller keeps it in memory). */
export function acknowledgeAiNotice(userId: string, now: Date = new Date()): boolean {
  if (!userId || typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(aiNoticeStorageKey(userId), now.toISOString());
    return true;
  } catch {
    return false;
  }
}
