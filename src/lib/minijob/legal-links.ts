/** The three public legal documents (routes need no login). */
export const LEGAL_LINKS = [
  { href: "/impressum", label: "Impressum" },
  { href: "/datenschutz", label: "Datenschutz" },
  { href: "/ki-hinweise", label: "KI-Hinweise" },
] as const;

export type LegalHref = (typeof LEGAL_LINKS)[number]["href"];

/** Overview page reached from the AI page; it only lists the three documents above. */
export const LEGAL_OVERVIEW_PATH = "/rechtliches";

const LEGAL_PATHS: readonly string[] = [
  ...LEGAL_LINKS.map((link) => link.href),
  LEGAL_OVERVIEW_PATH,
];

/** True for the public legal routes (documents + overview) (which must never be covered by onboarding/overlays). */
export function isLegalPath(pathname: string): boolean {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return LEGAL_PATHS.includes(normalized);
}
