import { Button } from "@/components/ui/button";
import type { TFunction } from "@/lib/i18n";
import { grossMinutes, isTimeValue } from "@/lib/minijob/entry-suggest";

/** B4: gängige Schichtlängen in Stunden; die Zeitfelder bleiben für eigene Werte. */
export const DURATION_PRESETS = [2, 4, 6, 8, 10] as const;

interface DurationChipsProps {
  start: string;
  end: string;
  /** Ende wurde von der Nutzerin selbst eingetragen – dann setzt kein Chip es still um. */
  endLocked: boolean;
  onSelect: (hours: number) => void;
  t: TFunction;
}

export function DurationChips({ start, end, endLocked, onSelect, t }: DurationChipsProps) {
  const enabled = isTimeValue(start) && !endLocked;
  const gross = grossMinutes(start, end);
  return (
    <div
      role="group"
      aria-label={t("entry.durationLabel")}
      data-testid="duration-chips"
      className="flex flex-wrap items-center gap-1.5 border-t border-border/70 px-3 py-2"
    >
      <span className="basis-full text-xs text-muted-foreground">{t("entry.durationLabel")}</span>
      {DURATION_PRESETS.map((hours) => {
        const selected = gross === hours * 60;
        return (
          <Button
            key={hours}
            type="button"
            variant={selected ? "default" : "outline"}
            size="sm"
            disabled={!enabled}
            aria-pressed={selected}
            data-testid={`duration-chip-${hours}`}
            className="h-11 min-w-11 px-3 text-sm tabular-nums"
            onClick={() => onSelect(hours)}
          >
            {hours} {t("entry.hoursShort")}
          </Button>
        );
      })}
      {endLocked ? (
        <p className="basis-full text-xs text-muted-foreground" data-testid="duration-locked-hint">
          {t("entry.durationLocked")}
        </p>
      ) : null}
    </div>
  );
}
