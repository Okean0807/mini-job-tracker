import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/datenschutz")({
  head: () => ({ meta: [{ title: "Datenschutz – MiniJob Tracker" }] }),
  component: DatenschutzPage,
});

function DatenschutzPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-8 pb-32">
      <h1 className="text-3xl font-extrabold tracking-tight">Datenschutz</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Technische Datenschutzhinweise für MiniJob Tracker. Diese Seite ist noch keine endgültige
        rechtliche Datenschutzerklärung.
      </p>

      <div className="mt-6 space-y-4">
        <section className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-5">
          <h2 className="text-lg font-bold">Status vor dem öffentlichen Release</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Verantwortlicher, Rechtsgrundlagen, konkrete Auftragsverarbeiter, Übermittlungen in
            Drittländer und verbindliche Löschfristen müssen mit der tatsächlich betriebenen
            Infrastruktur festgelegt und in die endgültige Datenschutzerklärung übernommen werden.
          </p>
        </section>

        <section className="rounded-xl border bg-card p-5">
          <h2 className="text-lg font-bold">Welche Daten können verarbeitet werden?</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
            <li>Arbeitszeiten, Schichten, Pausen, Stunden und Verdienstangaben.</li>
            <li>Angaben zu Arbeitgebern, Jobs, Zahlungen und Abwesenheiten.</li>
            <li>Von Nutzern hochgeladene Dokumente einschließlich technischer Metadaten.</li>
            <li>Kontodaten und App-Daten bei aktivierter Cloud-Synchronisierung.</li>
            <li>Bei einer KI-Anfrage der dafür ausgewählte App-Kontext.</li>
          </ul>
        </section>

        <section className="rounded-xl border bg-card p-5">
          <h2 className="text-lg font-bold">Speicherung</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Die Anwendung verwendet lokale Gerätespeicherung. Bei aktivierter Cloud-Funktion werden
            Daten zusätzlich im konfigurierten Supabase-Backend gespeichert. Hochgeladene Dokumente
            liegen in einem privaten Storage-Bereich. Die konkreten Aufbewahrungs- und Löschfristen
            sind deploymentspezifisch und müssen vor dem Release festgelegt werden.
          </p>
        </section>

        <section className="rounded-xl border bg-card p-5">
          <h2 className="text-lg font-bold">KI und externe Dienste</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Der aktuelle Code verwendet Gemini für die KI-Verarbeitung und Tavily für ausgewählte
            aktuelle Web-Suchen. Eine KI-Anfrage kann dafür Arbeits- und Verdienstkontext enthalten.
            Die endgültige Datenschutzerklärung muss die konkret eingesetzten Dienste, deren Rolle,
            Unterauftragsverarbeiter, Speicherfristen und Übermittlungsmechanismen anhand der
            tatsächlich aktivierten Produktionseinstellungen benennen.
          </p>
        </section>

        <section className="rounded-xl border bg-card p-5">
          <h2 className="text-lg font-bold">Ihre Rechte</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Die endgültige Erklärung muss die für den konkreten Betrieb geltenden Informationen zu
            Auskunft, Berichtigung, Löschung, Einschränkung, Widerspruch, Datenübertragbarkeit und
            Beschwerderechten enthalten.
          </p>
        </section>
      </div>

      <nav className="mt-6 flex flex-wrap gap-3 text-sm" aria-label="Rechtliche Informationen">
        <Link className="underline underline-offset-4" to="/impressum">Impressum</Link>
        <Link className="underline underline-offset-4" to="/ki-hinweise">KI-Hinweise</Link>
        <Link className="underline underline-offset-4" to="/einstellungen">Einstellungen</Link>
      </nav>
    </main>
  );
}
