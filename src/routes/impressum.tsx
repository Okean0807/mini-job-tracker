import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/impressum")({
  head: () => ({ meta: [{ title: "Impressum – MiniJob Tracker" }] }),
  component: ImpressumPage,
});

function ImpressumPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-8 pb-32">
      <h1 className="text-3xl font-extrabold tracking-tight">Impressum</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Anbieterinformationen gemäß den für den Dienst geltenden gesetzlichen Vorgaben.
      </p>

      <section className="mt-6 space-y-4 rounded-xl border bg-card p-5">
        <h2 className="text-lg font-bold">Anbieter</h2>
        <div className="rounded-lg border border-dashed p-4 text-sm">
          <p className="font-semibold">Noch nicht veröffentlicht</p>
          <p className="mt-2 text-muted-foreground">
            Vor dem öffentlichen Betrieb müssen hier Name/Firma, ladungsfähige Anschrift,
            Kontaktmöglichkeit und – soweit erforderlich – weitere Anbieterangaben des
            tatsächlichen Betreibers eingetragen werden.
          </p>
        </div>
        <p className="text-sm text-muted-foreground">
          Diese Seite ist bewusst keine erfundene Anbieterangabe. Platzhalter dürfen vor einem
          öffentlichen Release nicht als vollständiges Impressum verwendet werden.
        </p>
      </section>

      <nav className="mt-6 flex flex-wrap gap-3 text-sm" aria-label="Rechtliche Informationen">
        <Link className="underline underline-offset-4" to="/datenschutz">Datenschutz</Link>
        <Link className="underline underline-offset-4" to="/ki-hinweise">KI-Hinweise</Link>
        <Link className="underline underline-offset-4" to="/einstellungen">Einstellungen</Link>
      </nav>
    </main>
  );
}
