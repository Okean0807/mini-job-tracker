import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

/** Wizard `onDone`: hide the wizard and show the start page (never the page it was opened on). */
export function useWizardDone(hideWizard: () => void): () => void {
  const navigate = useNavigate();
  return useCallback(() => {
    hideWizard();
    void navigate({ to: "/", replace: true });
  }, [hideWizard, navigate]);
}
