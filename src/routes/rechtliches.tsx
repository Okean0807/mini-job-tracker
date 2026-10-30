import { createFileRoute } from "@tanstack/react-router";

import { LegalLinks } from "@/components/minijob/LegalLinks";
import { LegalPageShell } from "@/components/minijob/LegalPageShell";

export const Route = createFileRoute("/rechtliches")({
  head: () => ({ meta: [{ title: "Rechtliches – MiniJob Tracker" }] }),
  component: LegalOverviewPage,
});

function LegalOverviewPage() {
  return (
    <LegalPageShell>
      <h1 className="text-3xl font-extrabold tracking-tight">Rechtliches</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Rechtliche Informationen zu MiniJob Tracker.
      </p>
      <section className="mt-6 rounded-xl border bg-card p-5">
        <LegalLinks variant="list" />
      </section>
    </LegalPageShell>
  );
}
