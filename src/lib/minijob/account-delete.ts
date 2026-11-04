import { cloudClient } from "@/integrations/supabase/guarded-client";
import { clearAiChatHistory } from "./ai-chat-history";
import { clearUserScopeLocalData, GUEST_SCOPE, persistScopePointer } from "./storage-scope";

export type AccountDeleteResult = { ok: true } | { ok: false; error: unknown };

/** Permanently delete the authenticated account and app-owned cloud/local data. */
export async function deleteMyAccount(): Promise<AccountDeleteResult> {
  const { data, error: userError } = await cloudClient().auth.getUser();
  const userId = data.user?.id;
  if (userError || !userId) return { ok: false, error: userError ?? new Error("not-signed-in") };

  const { error } = await cloudClient().functions.invoke("delete-account", { method: "POST" });
  if (error) return { ok: false, error };

  clearUserScopeLocalData(userId);
  // The AI chat history is keyed differently (no ":u:" suffix) and holds questions + answers.
  clearAiChatHistory(userId);
  persistScopePointer(GUEST_SCOPE);

  try {
    await cloudClient().auth.signOut({ scope: "local" });
  } catch {
    // The account and app-owned local data are already deleted.
  }

  return { ok: true };
}
