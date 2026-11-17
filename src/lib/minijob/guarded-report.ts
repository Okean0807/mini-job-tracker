import { toast } from "sonner";

import type { GuardedResult } from "./guarded-operation";
import { guardedFeedback } from "./guarded-result";

/** Einheitliche Toast-Rückmeldung für das Ergebnis einer geschützten Operation. */
export function reportGuarded(
  result: GuardedResult,
  t: (key: string, vars?: Record<string, string | number>) => string,
  successText: string,
): void {
  const feedback = guardedFeedback(result);
  if (feedback.kind === "success")
    toast.success(feedback.unchanged ? t("guarded.unchanged") : successText);
  else if (feedback.kind === "cancelled") toast.message(t("guarded.cancelled"));
  else if (feedback.kind === "error") toast.error(feedback.text ?? t(feedback.key));
}
