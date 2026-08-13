import { supabase } from "@/integrations/supabase/client";

import { getData, onDataChange, replaceAll } from "./store";
import type { AppData } from "./types";

let userId: string | null = null;
let timeout: ReturnType<typeof setTimeout> | null = null;

async function push(data: AppData) {
  if (!userId) return;
  await supabase.from("backups").upsert({
    user_id: userId,
    payload: JSON.parse(JSON.stringify({ ...data, timer: null })),
    updated_at: new Date().toISOString(),
  });
}

/** Debounced automatisches Cloud-Backup. */
function scheduleBackup(data: AppData) {
  if (!userId || !data.settings.autoBackup) return;
  if (timeout) clearTimeout(timeout);
  timeout = setTimeout(() => {
    void push(data);
  }, 2500);
}

export async function backupNow(): Promise<void> {
  if (!userId) throw new Error("Nicht angemeldet");
  await push(getData());
}

export async function restoreNow(): Promise<boolean> {
  if (!userId) throw new Error("Nicht angemeldet");
  const { data, error } = await supabase
    .from("backups")
    .select("payload")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data?.payload) return false;
  replaceAll(data.payload as unknown as AppData);
  return true;
}

/** Nach Login: leeres Gerät automatisch wiederherstellen, sonst sichern. */
async function syncAfterLogin() {
  const local = getData();
  const hasLocal = local.shifts.length > 0 || local.jobs.length > 0;
  try {
    const restored = hasLocal ? false : await restoreNow();
    if (!restored) await push(getData());
  } catch {
    /* Sync-Fehler still ignorieren */
  }
}

let initialized = false;

export function initCloudSync() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  onDataChange((data) => scheduleBackup(data));

  supabase.auth.getSession().then(({ data }) => {
    if (data.session) {
      userId = data.session.user.id;
      void syncAfterLogin();
    }
  });

  supabase.auth.onAuthStateChange((event, session) => {
    userId = session?.user.id ?? null;
    if (event === "SIGNED_IN" && userId) void syncAfterLogin();
  });
}
