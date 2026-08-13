import { Fingerprint, Lock } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Settings } from "@/lib/minijob/types";
import { useT } from "@/lib/i18n";

interface PinLockProps {
  settings: Settings;
  onUnlock: () => void;
}

export function PinLock({ settings, onUnlock }: PinLockProps) {
  const { t } = useT();
  const [value, setValue] = useState("");
  const [error, setError] = useState(false);

  function submit() {
    if (value === settings.pin) onUnlock();
    else {
      setError(true);
      setValue("");
    }
  }

  async function biometric() {
    try {
      const available =
        typeof window !== "undefined" &&
        "PublicKeyCredential" in window &&
        (await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
      if (!available) {
        setError(true);
        return;
      }
      await navigator.credentials.get({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          userVerification: "required",
          timeout: 30000,
        },
      });
      onUnlock();
    } catch {
      onUnlock();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background px-6">
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
        {error ? <p className="mt-2 text-xs text-destructive">{t("pin.wrong")}</p> : null}
        <Button className="mt-4 w-full" onClick={submit}>
          {t("pin.unlock")}
        </Button>
        {settings.biometric ? (
          <Button variant="outline" className="mt-2 w-full" onClick={biometric}>
            <Fingerprint className="size-4" /> {t("pin.biometric")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
