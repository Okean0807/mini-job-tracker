import { Link } from "@tanstack/react-router";

import { LEGAL_LINKS, type LegalHref } from "@/lib/minijob/legal-links";

/**
 * Links to the public legal pages. They navigate inside the SPA (no page reload), so the
 * screen the user came from (onboarding step, AI chat, settings) keeps its state; the target
 * routes need no login. `newTab` is only for places that must stay untouched (the AI notice
 * dialog) and uses a plain anchor.
 */
export function LegalLinks({
  className = "",
  newTab = false,
  only,
  variant = "inline",
}: {
  className?: string;
  newTab?: boolean;
  /** Restrict to some documents (e.g. only KI-Hinweise next to the AI assistant). */
  only?: readonly LegalHref[];
  /** `list`: one link per row with a comfortable touch target (settings section). */
  variant?: "inline" | "list";
}) {
  const links = only ? LEGAL_LINKS.filter((link) => only.includes(link.href)) : LEGAL_LINKS;
  const layout =
    variant === "list"
      ? "flex flex-col text-sm"
      : "flex flex-wrap justify-center gap-x-4 gap-y-2 text-xs text-muted-foreground";
  const linkClass =
    variant === "list"
      ? "flex min-h-11 items-center underline underline-offset-4"
      : "inline-flex min-h-10 items-center underline underline-offset-4";
  return (
    <nav
      className={`${layout} ${className}`.trim()}
      aria-label="Rechtliche Informationen"
      data-testid="legal-links"
    >
      {links.map((link) =>
        newTab ? (
          <a
            key={link.href}
            className={linkClass}
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
          >
            {link.label}
          </a>
        ) : (
          <Link key={link.href} className={linkClass} to={link.href}>
            {link.label}
          </Link>
        ),
      )}
    </nav>
  );
}
