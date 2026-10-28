import { useCanGoBack, useNavigate, useRouter } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";

/**
 * Shared frame of the public legal pages: a visible back button at the top. It steps back in
 * the history (same as the Android system button / browser back) and falls back to the start
 * screen when the page was opened directly, e.g. in a new tab.
 */
export function LegalPageShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const navigate = useNavigate();
  const canGoBack = useCanGoBack();
  return (
    <main className="mx-auto max-w-2xl px-4 py-8 pb-32">
      <Button
        type="button"
        variant="ghost"
        className="-ml-3 mb-4 min-h-11 gap-2"
        data-testid="legal-back"
        onClick={() => (canGoBack ? router.history.back() : void navigate({ to: "/" }))}
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Zurück
      </Button>
      {children}
    </main>
  );
}
