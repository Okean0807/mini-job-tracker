import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/ki-hinweise")({
  head: () => ({ meta: [{ title: "KI-Hinweise – MiniJob Tracker" }] }),
  component: AiNoticePage,
});

function AiNoticePage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-8 pb-32">
      <h1 className="text-3xl font-extrabold tracking-tight">KI-Hinweise</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Technische Informationen zur optionalen Nutzung des KI-Assistenten.
      </p>

      <div className="mt-6 space-y-4">
        <section className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-5">
          <h2 className="text-lg font-bold">Vor dem öffentlichen Release</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Diese Seite beschreibt die aktuelle technische Architektur. Die endgültige
            Datenschutzerklärung muss die tatsächlich aktivierten KI-Dienste und ihre
            datenschutzrechtliche Einordnung verbindlich festlegen.
          </p>
        </section>

        <section className="rounded-xl border bg-card p-5">
          <h2 className="text-lg font-bold">Welche Daten können übertragen werden?</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Je nach Anfrage kann der Assistent Arbeitszeiten, Jobs, Stundenlöhne, Verdienstwerte,
            Monatswerte und gesetzliche Grenzwerte als Kontext erhalten. Der aktuelle Chat-Kontext
            wird durch die Anwendung begrenzt; die Anfrage wird anschließend an den konfigurierten
            KI-Dienst weitergegeben.
          </p>
        </section>

        <section className="rounded-xl border bg-card p-5">
          <h2 className="text-lg font-bold">Aktuelle technische Provider</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
            <li>Gemini: LLM-Verarbeitung der KI-Antwort.</li>
            <li>Tavily: optionale Web-Suche bei Fragen, für die aktuelle Informationen benötigt werden.</li>
          </ul>
          <p className="mt-3 text-sm text-muted-foreground">
            Welche konkreten Modelle, Konten, Regionen, Auftragsverarbeiter und Speicheroptionen in
            Produktion verwendet werden, muss vor dem Release anhand der Deployment-Konfiguration
            und der Verträge geprüft werden.
          </p>
        </section>

        <section className="rounded-xl border bg-card p-5">
          <h2 className="text-lg font-bold">Datensparsamkeit</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Der Assistent sollte nur den Kontext erhalten, der für die konkrete Funktion erforderlich
            ist. Nutzer können sensible Arbeits- und Verdienstinformationen enthalten; deshalb ist
            die KI-Funktion als optionaler Bestandteil der App zu behandeln.
          </p>
        </section>

        <section className="rounded-xl border bg-card p-5">
          <h2 className="text-lg font-bold">Kein Ersatz für Rechtsberatung</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Antworten des Assistenten sind informative Hilfestellung und ersetzen keine individuelle
            Rechts-, Steuer- oder Sozialversicherungsberatung.
          </p>
        </section>
      </div>

      <nav className="mt-6 flex flex-wrap gap-3 text-sm" aria-label="Rechtliche Informationen">
        <Link className="underline underline-offset-4" to="/impressum">Impressum</Link>
        <Link className="underline underline-offset-4" to="/datenschutz">Datenschutz</Link>
        <Link className="underline underline-offset-4" to="/einstellungen">Einstellungen</Link>
      </nav>
    </main>
  );
}
