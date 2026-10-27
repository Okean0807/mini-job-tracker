/**
 * Links to the public legal pages. Plain anchors on purpose: they work without a router
 * context (sign-in screen, onboarding) and the target routes need no login.
 * `newTab` keeps the current screen (e.g. an open AI notice) intact.
 */
export const LEGAL_LINKS = [
  { href: "/impressum", label: "Impressum" },
  { href: "/datenschutz", label: "Datenschutz" },
  { href: "/ki-hinweise", label: "KI-Hinweise" },
] as const;

export function LegalLinks({
  className = "",
  newTab = false,
}: {
  className?: string;
  newTab?: boolean;
}) {
  return (
    <nav
      className={`flex flex-wrap justify-center gap-x-4 gap-y-2 text-xs text-muted-foreground ${className}`.trim()}
      aria-label="Rechtliche Informationen"
      data-testid="legal-links"
    >
      {LEGAL_LINKS.map((link) => (
        <a
          key={link.href}
          className="underline underline-offset-4"
          href={link.href}
          {...(newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}
        >
          {link.label}
        </a>
      ))}
    </nav>
  );
}
