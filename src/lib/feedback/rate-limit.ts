/**
 * Einfache Frequenzbegrenzung im Arbeitsspeicher.
 *
 * ACHTUNG, bewusst begrenzt: Der Zustand lebt nur in EINER Serverinstanz. Bei mehreren oder neu
 * gestarteten Instanzen (Serverless) addieren sich die Grenzen; es ist keine harte Garantie. Die harte
 * Obergrenze ist das Tageskontingent des E-Mail-Dienstes. Für einen verlässlichen Schutz bräuchte man
 * gemeinsamen Speicher (z. B. Datenbank) – das ist hier absichtlich nicht gebaut.
 */
export interface RateLimitConfig {
  perUserPerHour: number;
  perUserPerDay: number;
  /** Alle Nutzer zusammen pro Stunde (pro Instanz). */
  globalPerHour: number;
}

export const DEFAULT_RATE_LIMITS: RateLimitConfig = {
  perUserPerHour: 5,
  perUserPerDay: 20,
  globalPerHour: 60,
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const MAX_TRACKED_USERS = 5_000;

export type RateDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

export interface RateLimiter {
  /** Prüft UND verbucht (nur bei erlaubter Anfrage). */
  consume(userId: string, now?: number): RateDecision;
}

export function createRateLimiter(config: RateLimitConfig = DEFAULT_RATE_LIMITS): RateLimiter {
  const perUser = new Map<string, number[]>();
  let global: number[] = [];

  const within = (stamps: number[], now: number, window: number) =>
    stamps.filter((s) => s > now - window && s <= now + 1_000);

  return {
    consume(userId, now = Date.now()) {
      const day = within(perUser.get(userId) ?? [], now, DAY);
      const hour = day.filter((s) => s > now - HOUR);
      global = within(global, now, HOUR);

      const wait = (stamps: number[], window: number) =>
        Math.max(1, Math.ceil((Math.min(...stamps) + window - now) / 1_000));

      let retry = 0;
      if (hour.length >= config.perUserPerHour) retry = wait(hour, HOUR);
      else if (day.length >= config.perUserPerDay) retry = wait(day, DAY);
      else if (global.length >= config.globalPerHour) retry = wait(global, HOUR);
      if (retry > 0) {
        perUser.set(userId, day);
        return { allowed: false, retryAfterSeconds: retry };
      }

      day.push(now);
      perUser.set(userId, day);
      global.push(now);
      if (perUser.size > MAX_TRACKED_USERS) {
        for (const [key, stamps] of perUser) {
          if (within(stamps, now, DAY).length === 0) perUser.delete(key);
        }
      }
      return { allowed: true };
    },
  };
}
