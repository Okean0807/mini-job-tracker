import { LEGAL_RULE_VERSIONS } from "./rules";

function minijobIncomeLimitFor(date: string): number {
  const iso = date.slice(0, 10);
  const match = LEGAL_RULE_VERSIONS.find(
    (version) =>
      version.effectiveFrom <= iso &&
      (!version.effectiveUntil || version.effectiveUntil >= iso),
  );
  if (!match) throw new Error(`Keine gesetzliche Regelversion für ${iso} hinterlegt.`);
  return Math.ceil(Number(((match.minimumWage * 130) / 3).toFixed(6)));
}

export const UNPREDICTABLE_MAX_MONTHS = 2;
export const UNPREDICTABLE_MONTH_MULTIPLIER = 2;

export interface MonthlyIncome {
  /** Monat als ISO-Datum, idealerweise erster Tag des Monats. */
  date: string;
  /** Für die Minijob-Grenze berücksichtigtes Entgelt dieses Monats. */
  earnings: number;
  /**
   * Vom Nutzer/Arbeitgeber als unvorhersehbares gelegentliches Überschreiten
   * dokumentiert. Die Engine entscheidet nicht selbst, ob ein Ereignis
   * tatsächlich "unvorhersehbar" war.
   */
  unpredictable?: boolean;
}

export interface UnpredictableExceedanceResult {
  regularLimit: number;
  maximumAllowedIncome: number;
  unpredictable: boolean;
  withinSingleMonthLimit: boolean;
  usedUnpredictableMonths: number;
  remainingUnpredictableMonths: number;
  allowed: boolean;
}

/**
 * Prüft die gesetzliche Sonderregel für ein einzelnes Überschreitungsereignis.
 *
 * Die Engine klassifiziert das Ereignis absichtlich nicht selbst als
 * "unvorhersehbar". Das muss aus den tatsächlichen Umständen stammen.
 */
export function evaluateUnpredictableMonth(
  date: string,
  earnings: number,
  usedUnpredictableMonthsInRolling12: number,
  documentedUnpredictable = false,
): UnpredictableExceedanceResult {
  const regularLimit = minijobIncomeLimitFor(date);
  const maximumAllowedIncome = regularLimit * UNPREDICTABLE_MONTH_MULTIPLIER;
  const unpredictable = documentedUnpredictable && earnings > regularLimit;
  const withinSingleMonthLimit = earnings <= maximumAllowedIncome;
  const usedUnpredictableMonths = Math.max(0, usedUnpredictableMonthsInRolling12);
  const remainingUnpredictableMonths = Math.max(
    0,
    UNPREDICTABLE_MAX_MONTHS - usedUnpredictableMonths,
  );

  return {
    regularLimit,
    maximumAllowedIncome,
    unpredictable,
    withinSingleMonthLimit,
    usedUnpredictableMonths,
    remainingUnpredictableMonths,
    allowed:
      earnings <= regularLimit ||
      (documentedUnpredictable &&
        withinSingleMonthLimit &&
        usedUnpredictableMonths < UNPREDICTABLE_MAX_MONTHS),
  };
}

/**
 * Prüft eine 12-Monats-Betrachtung.
 *
 * Die Eingabe muss bereits auf die maßgebliche Beschäftigung gefiltert sein.
 * Die Engine zählt ausschließlich ausdrücklich als unvorhersehbar markierte
 * Überschreitungsmonate.
 */
export function evaluateRolling12MonthExceedances(months: MonthlyIncome[]): {
  allowed: boolean;
  unpredictableMonths: MonthlyIncome[];
  invalidMonths: MonthlyIncome[];
  regularAnnualLimit: number;
  maximumAllowedAnnualIncome: number;
} {
  const ordered = [...months].sort((a, b) => a.date.localeCompare(b.date));
  const unpredictableMonths = ordered.filter(
    (m) => m.unpredictable && m.earnings > minijobIncomeLimitFor(m.date),
  );

  const invalidMonths = ordered.filter((m) => {
    const limit = minijobIncomeLimitFor(m.date);
    return m.earnings > limit * UNPREDICTABLE_MONTH_MULTIPLIER;
  });

  const regularAnnualLimit = ordered.reduce(
    (sum, month) => sum + minijobIncomeLimitFor(month.date),
    0,
  );
  const maximumAllowedAnnualIncome =
    regularAnnualLimit +
    unpredictableMonths.reduce((sum, month) => sum + minijobIncomeLimitFor(month.date), 0);

  return {
    allowed:
      unpredictableMonths.length <= UNPREDICTABLE_MAX_MONTHS && invalidMonths.length === 0,
    unpredictableMonths,
    invalidMonths,
    regularAnnualLimit,
    maximumAllowedAnnualIncome,
  };
}
