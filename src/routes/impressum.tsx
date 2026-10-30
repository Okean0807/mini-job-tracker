import { createFileRoute, Link } from "@tanstack/react-router";

import { LegalPageShell } from "@/components/minijob/LegalPageShell";

export const Route = createFileRoute("/impressum")({
  head: () => ({ meta: [{ title: "Impressum – MiniJob Tracker" }] }),
  component: ImpressumPage,
});

function ImpressumPage() {
  return (
    <LegalPageShell>
      <h1 className="text-3xl font-extrabold tracking-tight">Impressum</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Anbieterinformationen gemäß den für den Dienst geltenden gesetzlichen Vorgaben.
      </p>

      <section
        className="mt-6 space-y-4 rounded-xl border bg-card p-5"
        data-testid="impressum-anbieter"
      >
        <h2 className="text-lg font-bold">Anbieter</h2>
        <address className="text-sm not-italic">
          Juri Vollmer
          <br />
          Blumhardtstr. 23
          <br />
          30625 Hannover
          <br />
          Deutschland
        </address>
      </section>

      <section
        className="mt-4 space-y-2 rounded-xl border bg-card p-5"
        data-testid="impressum-kontakt"
      >
        <h2 className="text-lg font-bold">Kontakt</h2>
        <ul className="space-y-1 text-sm">
          <li>
            E-Mail:{" "}
            <a className="underline underline-offset-4" href="mailto:jurivollmer84@gmail.com">
              jurivollmer84@gmail.com
            </a>
          </li>
          <li>
            Telegram (weiterer Kontaktweg):{" "}
            <a
              className="underline underline-offset-4"
              href="https://t.me/Juri_Vollmer"
              target="_blank"
              rel="noopener noreferrer"
            >
              @Juri_Vollmer
            </a>
          </li>
        </ul>
      </section>

      <nav className="mt-6 flex flex-wrap gap-3 text-sm" aria-label="Rechtliche Informationen">
        <Link className="underline underline-offset-4" to="/datenschutz">
          Datenschutz
        </Link>
        <Link className="underline underline-offset-4" to="/ki-hinweise">
          KI-Hinweise
        </Link>
        <Link className="underline underline-offset-4" to="/einstellungen">
          Einstellungen
        </Link>
      </nav>
    </LegalPageShell>
  );
}
