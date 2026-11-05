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
 * - Each valid draft is reported as a number (live), an empty/invalid draft is not reported.
 * - The value at the start of the focus phase is kept as a snapshot. If the field is left with an
 *   empty/invalid draft, the snapshot is written back to the parent, so deleting digits one by one
 *   ("80" -> "8" -> "") can never leave an intermediate value ("8") behind.
 * - The same restore runs if the focused field is unmounted without a blur.
 * - On blur the draft is dropped, so the field shows the stored number again (leading zeros vanish).
 */
export function NumberField({
  value,
  onValueChange,
  min = 0,
  onFocus,
  onBlur,
  ...rest
}: NumberFieldProps) {
  const [draft, setDraft] = React.useState<string | null>(null);
  // Value when the current focus phase began; null while not editing.
  const snapshot = React.useRef<number | null>(null);
  // Latest props/draft for the unmount cleanup below (a closure from the first render would be stale).
  const latest = React.useRef({ value, draft, min, onValueChange });
  latest.current = { value, draft, min, onValueChange };
  // A focused field can be unmounted without a blur event (e.g. switching a Radix tab on mousedown).
  // Restore the focus-start snapshot in that case too, so an abandoned draft never leaves the
  // live-committed intermediate value ("8" after "80" -> "8" -> "") behind.
  React.useEffect(
    () => () => {
      const restore = snapshot.current;
      if (restore === null) return;
      const { value: current, draft: text, min: lowest, onValueChange: report } = latest.current;
      const invalidDraft = text !== null && parseNumericDraft(text, lowest) === null;
      if (invalidDraft && restore !== current) report(restore);
    },
    [],
  );
  return (
    <Input
      {...rest}
      type="number"
      min={min}
      value={draft ?? formatNumericValue(value)}
      onFocus={(e) => {
        snapshot.current = value;
        onFocus?.(e);
      }}
      onChange={(e) => {
        // Defensive: a change without a preceding focus event still gets a snapshot.
        if (snapshot.current === null) snapshot.current = value;
        const raw = e.target.value;
        setDraft(raw);
        const parsed = parseNumericDraft(raw, min);
        if (parsed !== null) onValueChange(parsed);
      }}
      onBlur={(e) => {
        const restore = snapshot.current;
        const invalidDraft = draft !== null && parseNumericDraft(draft, min) === null;
        if (invalidDraft && restore !== null && restore !== value) onValueChange(restore);
        snapshot.current = null;
        setDraft(null);
        onBlur?.(e);
      }}
    />
  );
}
