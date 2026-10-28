import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useT } from "@/lib/i18n";

import { LegalLinks } from "./LegalLinks";

/**
 * Shown once per user before the first AI request. Nothing is sent until the user confirms;
 * cancelling leaves every other function of the app untouched.
 */
export function AiNoticeDialog({
  open,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useT();
  return (
    <AlertDialog open={open} onOpenChange={(next) => (next ? undefined : onCancel())}>
      <AlertDialogContent data-testid="ai-notice-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("ai.notice.title")}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-left text-sm">
              <p>{t("ai.notice.intro")}</p>
              <p>{t("ai.notice.data")}</p>
              <p>{t("ai.notice.providers")}</p>
              <p>{t("ai.notice.optional")}</p>
              <LegalLinks newTab className="justify-start" />
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>{t("ai.notice.cancel")}</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{t("ai.notice.confirm")}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
