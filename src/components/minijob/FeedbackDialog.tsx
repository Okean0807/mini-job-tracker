import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { MessageSquare, Star } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { useAuthSession } from "@/hooks/use-auth-session";
import { useT } from "@/lib/i18n";
import { sendFeedback } from "@/lib/feedback/client";
import { feedbackContext } from "@/lib/feedback/context";
import { submitFeedback } from "@/lib/feedback/feedback.functions";
import {
  FEEDBACK_KINDS,
  MAX_FEEDBACK_CHARS,
  MIN_FEEDBACK_CHARS,
  feedbackSchema,
  type FeedbackInput,
  type FeedbackKind,
} from "@/lib/feedback/schema";

type Submit = (args: { data: FeedbackInput }) => Promise<unknown>;

const newSubmissionId = () => crypto.randomUUID();

/** Einstellungen → Allgemein: Feedback (Fehler, Idee, Bewertung). Auch für Gäste. */
export function FeedbackSection({
  submit = submitFeedback as Submit,
  onOpenAccount,
}: {
  submit?: Submit;
  /** Wechselt zum Tab „Konto“, wo man sich anmelden kann. */
  onOpenAccount?: () => void;
}) {
  const { t, lang } = useT();
  // Feedback nur für angemeldete Nutzer. Erst nach dem Laden des Anmeldestatus („loading“ → bereit)
  // wird einem Gast die Anmeldung vorgeschlagen, damit nichts kurz aufblitzt.
  const { status: authStatus } = useAuthSession();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<FeedbackKind>("bug");
  const [rating, setRating] = useState(0);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Eine ID pro Formular: eine Wiederholung nach Netzwerkfehler wird serverseitig nie doppelt gespeichert.
  const submissionId = useRef(newSubmissionId());
  const sendingRef = useRef(false);

  function reset() {
    setKind("bug");
    setRating(0);
    setMessage("");
    setError(null);
    submissionId.current = newSubmissionId();
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (sendingRef.current) return; // Doppelklick / Enter-Wiederholung
    if (authStatus !== "signed_in") return; // auch ohne UI-Sperre nie als Gast senden
    const ctx = feedbackContext(
      window.location.pathname,
      import.meta.env["VITE_APP_VERSION"] as string | undefined,
      lang,
    );
    const input = {
      submissionId: submissionId.current,
      kind,
      message: message.trim(),
      ...(kind === "rating" ? { rating } : {}),
      ...ctx,
    };
    const parsed = feedbackSchema.safeParse(input);
    if (!parsed.success) {
      const paths = parsed.error.issues.map((i) => i.path.join("."));
      setError(
        paths.includes("rating") && kind === "rating" && rating === 0
          ? t("fb.error.ratingRequired")
          : paths.includes("message")
            ? t("fb.error.messageRequired", { min: MIN_FEEDBACK_CHARS })
            : t("fb.error.invalid"),
      );
      return;
    }

    sendingRef.current = true;
    setSending(true);
    setError(null);
    try {
      const outcome = await sendFeedback(parsed.data, submit);
      if (outcome.status === "sent") {
        toast.success(t("fb.success"));
        setOpen(false);
        reset();
        return;
      }
      const text =
        outcome.status === "offline"
          ? t("fb.error.offline")
          : outcome.status === "unauthenticated"
            ? t("fb.error.unauthenticated")
            : outcome.status === "forbidden"
              ? t("fb.error.forbidden")
              : outcome.status === "rate_limited"
                ? t("fb.error.rate", {
                    minutes: Math.max(1, Math.ceil(outcome.retryAfterSeconds / 60)),
                  })
                : outcome.status === "invalid"
                  ? t("fb.error.invalid")
                  : t("fb.error.network");
      setError(text);
      toast.error(text);
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  const kindLabel: Record<FeedbackKind, string> = {
    bug: t("fb.kind.bug"),
    idea: t("fb.kind.idea"),
    rating: t("fb.kind.rating"),
  };

  return (
    <section className="space-y-3 rounded-2xl border bg-card p-4 shadow-card">
      <h2 className="text-sm font-semibold">{t("fb.title")}</h2>
      <p className="text-xs text-muted-foreground">{t("fb.desc")}</p>
      {authStatus === "signed_out" ? (
        <div className="space-y-2" data-testid="feedback-signin">
          <p className="rounded-xl bg-muted p-3 text-xs" role="status">
            {t("fb.signIn.required")}
          </p>
          {onOpenAccount ? (
            <Button
              variant="outline"
              className="min-h-11 w-full"
              data-testid="feedback-signin-action"
              onClick={onOpenAccount}
            >
              {t("fb.signIn.action")}
            </Button>
          ) : null}
        </div>
      ) : (
        <Button
          variant="outline"
          className="min-h-11 w-full"
          aria-haspopup="dialog"
          data-testid="feedback-open"
          // Während der Anmeldestatus lädt: sichtbar, aber gesperrt und ohne Anmelde-Hinweis.
          disabled={authStatus !== "signed_in"}
          aria-busy={authStatus === "loading" ? true : undefined}
          onClick={() => setOpen(true)}
        >
          <MessageSquare className="size-4" /> {t("fb.open")}
        </Button>
      )}

      <Dialog
        open={open && authStatus === "signed_in"}
        onOpenChange={(v) => (!sending ? setOpen(v) : undefined)}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("fb.dialog.title")}</DialogTitle>
            <DialogDescription>{t("fb.dialog.desc")}</DialogDescription>
          </DialogHeader>

          <form className="space-y-4" onSubmit={onSubmit} noValidate data-testid="feedback-form">
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">{t("fb.kind.label")}</legend>
              <RadioGroup
                value={kind}
                onValueChange={(v) => {
                  setKind(v as FeedbackKind);
                  setError(null);
                }}
                aria-label={t("fb.kind.label")}
              >
                {FEEDBACK_KINDS.map((k) => (
                  <div key={k} className="flex min-h-11 items-center gap-3">
                    <RadioGroupItem value={k} id={`fb-kind-${k}`} />
                    <Label htmlFor={`fb-kind-${k}`} className="flex-1 cursor-pointer text-sm">
                      {kindLabel[k]}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </fieldset>

            {kind === "rating" ? (
              <div className="space-y-2">
                <Label id="fb-rating-label" className="text-sm font-medium">
                  {t("fb.rating.label")}
                </Label>
                <RadioGroupPrimitive.Root
                  aria-labelledby="fb-rating-label"
                  value={rating ? String(rating) : ""}
                  onValueChange={(v) => {
                    setRating(Number(v));
                    setError(null);
                  }}
                  orientation="horizontal"
                  className="flex gap-1"
                >
                  {[1, 2, 3, 4, 5].map((n) => (
                    <RadioGroupPrimitive.Item
                      key={n}
                      value={String(n)}
                      aria-label={t("fb.rating.star", { n })}
                      data-testid={`feedback-star-${n}`}
                      className="flex size-11 items-center justify-center rounded-md text-amber-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Star
                        className={n <= rating ? "size-7 fill-current" : "size-7"}
                        aria-hidden
                      />
                    </RadioGroupPrimitive.Item>
                  ))}
                </RadioGroupPrimitive.Root>
              </div>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="fb-message" className="text-sm font-medium">
                {t("fb.message.label")}
              </Label>
              <Textarea
                id="fb-message"
                value={message}
                maxLength={MAX_FEEDBACK_CHARS}
                rows={6}
                placeholder={t(`fb.message.placeholder.${kind}`)}
                aria-describedby="fb-privacy fb-counter"
                aria-invalid={error ? true : undefined}
                onChange={(e) => {
                  setMessage(e.target.value);
                  setError(null);
                }}
              />
              <p
                id="fb-counter"
                className="text-right text-xs text-muted-foreground"
                data-testid="feedback-counter"
              >
                {t("fb.counter", { count: message.length, max: MAX_FEEDBACK_CHARS })}
              </p>
              <p
                id="fb-privacy"
                className="rounded-xl bg-muted p-3 text-xs"
                data-testid="feedback-privacy"
              >
                {t("fb.privacy")}
              </p>
            </div>

            {error ? (
              <p role="alert" className="text-sm text-destructive" data-testid="feedback-error">
                {error}
              </p>
            ) : null}

            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                className="min-h-11 flex-1"
                disabled={sending}
                onClick={() => setOpen(false)}
              >
                {t("fb.cancel")}
              </Button>
              <Button
                type="submit"
                className="min-h-11 flex-1"
                disabled={sending}
                aria-busy={sending}
                data-testid="feedback-submit"
              >
                {sending ? t("fb.sending") : t("fb.send")}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
