import { Button } from "@/components/ui/button";
import type { PauseSuggestion } from "@/lib/minijob/entry-suggest";

/** B2: feste Schnellauswahl; das Zahlenfeld daneben bleibt für eigene Werte. */
export const PAUSE_PRESETS = [0, 15, 30, 45, 60] as const;

interface PauseChipsProps {
  /** Aktueller Feldtext (Quelle der Wahrheit bleibt der Editor-State, später `breakMinutes`). */
  value: string;
  onSelect: (minutes: number) => void;
  suggestion: PauseSuggestion;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

function parsed(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function PauseChips({ value, onSelect, suggestion, t }: PauseChipsProps) {
  const current = parsed(value);
  const suggested = new Set<number>(
    [suggestion.last, suggestion.frequent].filter((n): n is number => n !== undefined),
  );
  const extras = [...suggested].filter((n) => !(PAUSE_PRESETS as readonly number[]).includes(n));
  const items: number[] = [...PAUSE_PRESETS, ...extras.sort((a, b) => a - b)];

  return (
    <div
      role="group"
      aria-label={t("entry.break")}
      data-testid="pause-chips"
      className="flex flex-wrap gap-1.5 border-t border-border/70 px-3 py-2"
    >
      {items.map((minutes) => {
        const selected = current === minutes;
        const isSuggested = suggested.has(minutes);
        const label =
          minutes === 0 ? t("entry.pauseNone") : `${minutes} ${t("entry.minutesShort")}`;
        return (
          <Button
            key={minutes}
            type="button"
            variant={selected ? "default" : "outline"}
            size="sm"
            aria-pressed={selected}
            data-testid={`pause-chip-${minutes}`}
            {...(isSuggested ? { "data-suggested": "true" } : {})}
            className="h-11 min-w-11 px-3 text-sm tabular-nums"
            onClick={() => onSelect(minutes)}
          >
            {label}
            {isSuggested && !selected ? (
              <span className="sr-only"> ({t("entry.pauseSuggested")})</span>
            ) : null}
          </Button>
        );
      })}
      {suggestion.last !== undefined ? (
        <p className="basis-full text-xs text-muted-foreground" data-testid="pause-last-hint">
          {t("entry.pauseLastHint", { minutes: suggestion.last })}
        </p>
      ) : null}
    </div>
  );
}
