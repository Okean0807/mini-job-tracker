/**
 * Data-safety Phase 1: Herkunfts-Prüfung (reine Funktionen, kein Zugriff auf window).
 *
 * Lokale Daten und die Anmeldung gelten je Adresse (Origin) und Browserprofil. Nur die kanonische
 * Produktionsadresse ist der erwartete Ort; Vorschau-/Deployment-Adressen oder fremde Hosts
 * warnen, Entwicklung (localhost) bleibt still. Der Testmodus warnt immer als "nur lokal".
 */

/** Kanonische Produktionsadresse (Entscheidung des Betreibers). */
export const CANONICAL_HOST = "mini-job-tracker-blue.vercel.app";

export type OriginClass = "canonical" | "development" | "non-canonical";

export type OriginNoticeReason = "canonical" | "development" | "non-canonical-host" | "test-mode";

export interface OriginNotice {
  origin: OriginClass;
  /** Soll ein Warnhinweis erscheinen? */
  warn: boolean;
  reason: OriginNoticeReason;
}

/** Hostname aus Host, Host:Port oder URL; leer/ungültig → `null`. */
export function hostnameOf(input: string | null | undefined): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim().toLowerCase();
  if (trimmed === "") return null;
  let host = trimmed;
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(trimmed)) {
    try {
      host = new URL(trimmed).hostname;
    } catch {
      return null;
    }
  } else {
    host = trimmed.replace(/[/?#].*$/, "");
    if (host.startsWith("[")) {
      const end = host.indexOf("]");
      host = end > 0 ? host.slice(0, end + 1) : host;
    } else {
      host = host.replace(/:\d+$/, "");
    }
  }
  host = host.replace(/\.$/, "");
  return host === "" ? null : host;
}

function isDevelopmentHost(host: string): boolean {
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "127.0.0.1" ||
    host === "[::1]" ||
    host === "::1"
  );
}

export function classifyOrigin(hostOrUrl: string | null | undefined): OriginClass {
  const host = hostnameOf(hostOrUrl);
  if (host === null) return "non-canonical";
  if (host === CANONICAL_HOST) return "canonical";
  if (isDevelopmentHost(host)) return "development";
  return "non-canonical";
}

/**
 * Hinweis für die Oberfläche. Der Testmodus hat Vorrang: Daten bleiben dort auf dem Gerät,
 * unabhängig von der Adresse.
 */
export function deriveOriginNotice(
  hostOrUrl: string | null | undefined,
  options: { testMode?: boolean } = {},
): OriginNotice {
  const origin = classifyOrigin(hostOrUrl);
  if (options.testMode === true) return { origin, warn: true, reason: "test-mode" };
  if (origin === "canonical") return { origin, warn: false, reason: "canonical" };
  if (origin === "development") return { origin, warn: false, reason: "development" };
  return { origin, warn: true, reason: "non-canonical-host" };
}
