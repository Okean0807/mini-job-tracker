import type { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";

import { isCloudMode } from "@/lib/cloud/cloud-mode";

import { cloudClient } from "@/integrations/supabase/guarded-client";
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
    // Public Local build: there is no account. Never touch the Supabase client (no auth listener,
    // no session restore, no token refresh) - the user is simply "signed out" on this device.
    if (!isCloudMode()) {
      setSession(null);
      setPhase("ready");
      return undefined;
    }
    try {
      return bindAuthSession(cloudClient(), (next) => {
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
