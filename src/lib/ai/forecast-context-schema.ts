/**
 * PROPOSAL (not wired in): strict schema for a top-level `forecast` block in the
 * client-built AI context. Nothing imports this module yet: buildAssistantContext,
 * checkContext/ALLOWED_CONTEXT_KEYS and the system instruction are unchanged, so
 * production behaviour is identical until the owner approves the wiring.
 *
 * Design (see docs of the review): the browser-built context is untrusted, so the
 * block is validated as a unit instead of adding its field names to the global,
 * path-insensitive ALLOWED_CONTEXT_KEYS. The schema is `.strict()` at every level
 * and contains no string fields at all: no free text, no rules, no instructions
 * can travel through it. Only recorded facts are allowed in this first version;
 * planned future shifts and extrapolated amounts are deliberately NOT part of it.
 */
import { z } from "zod";

const MAX_HOURS_PER_MONTH = 744; // 31 days x 24 h
const MAX_MONEY = 1_000_000;

const count = z.number().int().min(0).max(5000);
const hours = z.number().finite().min(0).max(MAX_HOURS_PER_MONTH);
const money = z.number().finite().min(0).max(MAX_MONEY);

export const forecastBlockSchema = z
  .object({
    /** At least one entry exists in the current month (same rule as the context builder). */
    dataBasedForecastPossible: z.boolean(),
    /** Calendar day of the month "today" (1-based) and length of the month. */
    daysElapsed: z.number().int().min(1).max(31),
    daysInMonth: z.number().int().min(28).max(31),
    /** Mon-Fri after today: calendar only, never the user's workdays. */
    calendarWeekdaysRemaining: z.number().int().min(0).max(23),
    /** Entries dated up to and including today, all jobs (actual recorded work). */
    recordedToDate: z.object({ entriesCount: count, hours, earnings: money }).strict(),
    /**
     * false when O4 applies or is uncertain for the rolling forecast period
     * (multiMinijob.forecast / forecastUncertain): no Minijob headroom may be given.
     */
    minijobBasisReliable: z.boolean(),
    /**
     * Monthly limit minus currentMonth.minijobEarnings (monthUsage up to today);
     * headroom, not expected income. Negative = above the displayed value.
     */
    remainingLimitAmount: z.number().finite().min(-MAX_MONEY).max(MAX_MONEY).nullable(),
  })
  .strict()
  .superRefine((f, ctx) => {
    if (f.daysElapsed > f.daysInMonth) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "daysElapsed > daysInMonth" });
    }
    if (!f.minijobBasisReliable && f.remainingLimitAmount !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "O4: no headroom when the Minijob basis is unreliable",
      });
    }
  });

export type ForecastBlock = z.infer<typeof forecastBlockSchema>;

export type ForecastCheck =
  { ok: true; forecast: ForecastBlock | undefined } | { ok: false; reason: "forecast_invalid" };

/**
 * `undefined` (key absent) is accepted: current behaviour is kept for older
 * clients. Anything else must match the schema exactly; `null`, arrays, strings,
 * extra keys and out-of-range numbers fail closed. Never echoes the input.
 */
export function checkForecastBlock(value: unknown): ForecastCheck {
  if (value === undefined) return { ok: true, forecast: undefined };
  const parsed = forecastBlockSchema.safeParse(value);
  return parsed.success
    ? { ok: true, forecast: parsed.data }
    : { ok: false, reason: "forecast_invalid" };
}
