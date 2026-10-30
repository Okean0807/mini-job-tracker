import { useEffect, useState } from "react";

import { type AiAvailability, resolveAiAvailability } from "@/lib/ai/availability";
import { getAiStatus } from "@/lib/ai-status.functions";

let settled: "enabled" | "disabled" | null = null;
let inflight: Promise<"enabled" | "disabled"> | null = null;

function fetchAvailability(): Promise<"enabled" | "disabled"> {
  inflight ??= getAiStatus()
    .then((result) => {
      settled = resolveAiAvailability(result);
      return settled;
    })
    .catch(() => "disabled" as const) // unknown state → unavailable; retried on next mount
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** "loading" until the server answered; only an explicit enabled answer turns the AI UI on. */
export function useAiAvailability(): AiAvailability {
  const [state, setState] = useState<AiAvailability>(settled ?? "loading");
  useEffect(() => {
    if (settled) {
      setState(settled);
      return;
    }
    let alive = true;
    void fetchAvailability().then((next) => {
      if (alive) setState(next);
    });
    return () => {
      alive = false;
    };
  }, []);
  return state;
}
