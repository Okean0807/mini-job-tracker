import { KeyRound, Lock } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/lib/i18n";
import {
  attemptBiometricUnlock,
  shouldUnlockFromBiometric,
} from "@/lib/minijob/biometric";
import type { Settings } from "@/lib/minijob/types";

interface PinLockProps {
  settings: Settings;
  onUnlock: () => void;
}

export function PinLock({ settings, onUnlock }: PinLockProps) {
  const { t } = useT();
  const [value, setValue] = useState("");
  const [error, setError] = useState(false);
  const [errorKey, setErrorKey] = useState<"pin.wrong" | "pin.biometricFailed">("pin.wrong");
  const [busy, setBusy] = useState(false);

  const biometricReady = Boolean(settings.biometric && settings.biometricCredentialId);

  function submit() {
    if (value === settings.pin) onUnlock();
    else {
      setErrorKey("pin.wrong");
      setError(true);
      setValue("");
    }
  }

  async function biometric() {
    if (busy) return;
    setBusy(true);
    setError(false);
    try {
      const result = await attemptBiometricUnlock(settings.biometricCredentialId);
      if (shouldUnlockFromBiometric(result)) {
        onUnlock();
        return;
      }
      setErrorKey("pin.biometricFailed");
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background px-6"
      style={{
        paddingTop: "max(1.5rem, env(safe-area-inset-top, 0px))",
        paddingBottom: "max(1.5rem, env(safe-area-inset-bottom, 0px))",
        paddingLeft: "max(1.5rem, env(safe-area-inset-left, 0px))",
        paddingRight: "max(1.5rem, env(safe-area-inset-right, 0px))",
      }}
      data-testid="pin-lock"
    >
      <div className="w-full max-w-xs text-center">
        <Lock className="mx-auto size-10 text-primary" />
        <h1 className="mt-4 text-xl font-bold">{t("pin.locked")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("pin.enterPin")}</p>
        <Input
          type="password"
          inputMode="numeric"
          autoFocus
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(false);
          }}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          className="mt-4 text-center text-lg tracking-[0.4em]"
          aria-label={t("pin.enterPin")}
        />
        {error ? <p className="mt-2 text-xs text-destructive">{t(errorKey)}</p> : null}
        <Button className="mt-4 min-h-11 w-full" onClick={submit}>
          {t("pin.unlock")}
        </Button>
        {biometricReady ? (
          <Button
            variant="outline"
            className="mt-2 min-h-11 w-full"
            onClick={biometric}
            disabled={busy}
          >
            <KeyRound className="size-4" aria-hidden /> {t("pin.biometric")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
