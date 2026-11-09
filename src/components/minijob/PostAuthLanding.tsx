import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";

import type { AuthSessionStatus } from "@/lib/minijob/auth-session";
import {
  clearOAuthLanding,
  isOAuthLandingPending,
  resolvePostAuthLanding,
} from "@/lib/minijob/post-auth-landing";

/**
 * Effect-only component: after a Google sign-in started in this tab, moves the user to `/`
 * once the session and the first profile restore are settled (see post-auth-landing.ts).
 * The marker is cleared before navigating, so this runs at most once.
 */
export function PostAuthLanding({
  authStatus,
  restorePending,
  onSettled,
}: {
  authStatus: AuthSessionStatus;
  restorePending: boolean;
  onSettled?: () => void;
}) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  useEffect(() => {
    if (!isOAuthLandingPending()) return;
    const decision = resolvePostAuthLanding({ authStatus, pathname, restorePending });
    if (decision === "wait") return;
    clearOAuthLanding();
    onSettled?.();
    if (decision === "go-home") void navigate({ to: "/", replace: true });
  }, [authStatus, pathname, restorePending, navigate, onSettled]);

  return null;
}
