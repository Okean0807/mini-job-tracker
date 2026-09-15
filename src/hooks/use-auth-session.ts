import type { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import {
  authSessionStatus,
  bindAuthSession,
  type AuthSessionStatus,
} from "@/lib/minijob/auth-session";

export type { AuthSessionStatus };

export type AuthSessionState = {
  status: AuthSessionStatus;
  session: Session | null;
};

/**
 * Shared auth UI state: subscribe-first via bindAuthSession.
 * Starts as `loading` so consumers do not treat pre-hydrate null as signed_out.
 */
export function useAuthSession(): AuthSessionState {
  const [session, setSession] = useState<Session | null>(null);
  const [phase, setPhase] = useState<"pending" | "ready">("pending");

  useEffect(() => {
    try {
      return bindAuthSession(supabase, (next) => {
        setSession(next);
        setPhase("ready");
      });
    } catch (error) {
      console.error("[useAuthSession] Supabase auth unavailable", error);
      setSession(null);
      setPhase("ready");
      return undefined;
    }
  }, []);

  return { status: authSessionStatus(phase, session), session };
}
