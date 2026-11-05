import * as React from "react";

import { Input } from "@/components/ui/input";
import { formatNumericValue, parseNumericDraft } from "@/lib/numeric-input";

export type NumberFieldProps = Omit<
  React.ComponentProps<typeof Input>,
  "type" | "value" | "defaultValue" | "onChange"
> & {
  /** Current stored value (always a number). */
  value: number;
  /**
   * Called only with a valid number (see `parseNumericDraft`). An empty or invalid draft is
   * never reported, so it can never be stored as 0.
   */
  onValueChange: (value: number) => void;
  /** Smallest accepted value (default 0: negative input is rejected). */
  min?: number;
};

/**
 * Numeric input with a text draft while editing.
 * - While focused the field shows exactly what the user typed (empty, "0", "080", pasted text).
 * - Each valid draft is reported as a number; an empty/invalid draft is not reported.
 * - On blur the draft is dropped, so the field shows the stored number again: leading zeros
 *   vanish and an empty/invalid draft restores the last valid value.
 */
export function NumberField({ value, onValueChange, min = 0, onBlur, ...rest }: NumberFieldProps) {
  const [draft, setDraft] = React.useState<string | null>(null);
  return (
    <Input
      {...rest}
      type="number"
      min={min}
      value={draft ?? formatNumericValue(value)}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        const parsed = parseNumericDraft(raw, min);
        if (parsed !== null) onValueChange(parsed);
      }}
      onBlur={(e) => {
        setDraft(null);
        onBlur?.(e);
      }}
    />
  );
}
