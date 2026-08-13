import { createFileRoute } from "@tanstack/react-router";
import { Briefcase, Plus, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { JobDialog } from "@/components/minijob/JobDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatEuro } from "@/lib/minijob/calc";
import { weeklyPlanHours } from "@/lib/minijob/schedule";
import {
  deleteCustomer,
  deleteProject,
  newId,
  saveCustomer,
  saveProject,
  updateSettings,
  useAppData,
} from "@/lib/minijob/store";
import { WORK_MODE_LABEL, type Job } from "@/lib/minijob/types";

export const Route = createFileRoute("/jobs")({
  head: () => ({
    meta: [
      { title: "Jobs & Kunden – MiniJob Tracker" },
      {
        name: "description",
        content:
          "Beliebig viele Jobs mit Farbe, Stundenlohn, Arbeitgeber und Kontaktdaten verwalten – plus Kunden und Projekte für Selbstständige.",
      },
      { property: "og:title", content: "Jobs & Kunden – MiniJob Tracker" },
      {
        property: "og:description",
        content: "Jobs, Wochenpläne, Zuschläge sowie Kunden und Projekte verwalten.",
      },
    ],
  }),
  component: JobsPage,
});

function JobsPage() {
  const { jobs, customers, projects, settings, shifts } = useAppData();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Job | null>(null);

  return (
    <main className="mx-auto max-w-lg px-4 pt-6">
      <h1 className="text-2xl font-extrabold tracking-tight">Jobs</h1>

      <Tabs defaultValue="jobs" className="mt-4">
        <TabsList className="w-full">
          <TabsTrigger value="jobs" className="flex-1">
            Jobs
          </TabsTrigger>
          <TabsTrigger value="kunden" className="flex-1">
            Kunden &amp; Projekte
          </TabsTrigger>
        </TabsList>

        <TabsContent value="jobs" className="mt-4 space-y-3">
          {jobs.length === 0 ? (
            <div className="rounded-2xl border border-dashed p-8 text-center">
              <Briefcase className="mx-auto size-8 text-muted-foreground" />
              <p className="mt-3 text-sm text-muted-foreground">
                Noch kein Job angelegt. Lege deinen ersten Job an, um Schichten zuzuordnen.
              </p>
            </div>
          ) : null}

          {jobs.map((job) => {
            const count = shifts.filter((s) => s.jobId === job.id).length;
            return (
              <button
                key={job.id}
                type="button"
                onClick={() => {
                  setEditing(job);
                  setOpen(true);
                }}
                className="flex w-full items-center gap-3 rounded-2xl border bg-card p-4 text-left shadow-card"
              >
                <span
                  className="size-10 shrink-0 rounded-xl"
                  style={{ backgroundColor: job.color }}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{job.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {WORK_MODE_LABEL[job.mode]} · {formatEuro(job.rate)}/Std.
                    {job.mode === "fest" ? ` · ${weeklyPlanHours(job).toFixed(1)} h/Woche` : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {count} {count === 1 ? "Eintrag" : "Einträge"}
                    {settings.activeJobId === job.id ? " · aktiv" : ""}
                  </p>
                </div>
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    updateSettings({ activeJobId: job.id });
                    toast.success(`${job.name} ist jetzt aktiv`);
                  }}
                  onKeyDown={(e) => e.stopPropagation()}
                  className="rounded-lg border px-2 py-1 text-xs"
                >
                  Aktiv
                </span>
              </button>
            );
          })}

          <Button
            className="w-full"
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            <Plus className="size-4" /> Job hinzufügen
          </Button>
        </TabsContent>

        <TabsContent value="kunden" className="mt-4 space-y-4">
          <section className="space-y-3">
            <h2 className="text-sm font-semibold">Kunden</h2>
            {customers.length === 0 ? (
              <div className="rounded-2xl border border-dashed p-6 text-center">
                <Users className="mx-auto size-7 text-muted-foreground" />
                <p className="mt-2 text-xs text-muted-foreground">
                  Für selbstständige Tätigkeiten: Kunden anlegen und Schichten zuordnen.
                </p>
              </div>
            ) : (
              <ul className="space-y-2">
                {customers.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center justify-between rounded-2xl border bg-card p-3"
                  >
                    <div>
                      <p className="text-sm font-semibold">{c.name}</p>
                      {c.rate ? (
                        <p className="text-xs text-muted-foreground">{formatEuro(c.rate)}/Std.</p>
                      ) : null}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      onClick={() => deleteCustomer(c.id)}
                    >
                      Löschen
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <AddCustomer />
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold">Projekte</h2>
            <ul className="space-y-2">
              {projects.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between rounded-2xl border bg-card p-3"
                >
                  <div>
                    <p className="text-sm font-semibold">{p.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {customers.find((c) => c.id === p.customerId)?.name ?? "Ohne Kunde"}
                      {p.rate ? ` · ${formatEuro(p.rate)}/Std.` : ""}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                    onClick={() => deleteProject(p.id)}
                  >
                    Löschen
                  </Button>
                </li>
              ))}
            </ul>
            <AddProject />
          </section>
        </TabsContent>
      </Tabs>

      <JobDialog
        open={open}
        onOpenChange={setOpen}
        job={editing}
        defaultRate={settings.defaultRate}
      />
    </main>
  );
}

function AddCustomer() {
  const [name, setName] = useState("");
  const [rate, setRate] = useState("");

  return (
    <div className="space-y-2 rounded-2xl border bg-card p-3">
      <Label className="text-xs">Neuer Kunde</Label>
      <div className="flex gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
        <Input
          className="w-24"
          type="number"
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          placeholder="€/h"
        />
        <Button
          onClick={() => {
            if (!name.trim()) return;
            const customer = {
              id: newId(),
              name: name.trim(),
              ...(rate ? { rate: Number(rate.replace(",", ".")) } : {}),
            };
            saveCustomer(customer);
            setName("");
            setRate("");
            toast.success("Kunde angelegt");
          }}
        >
          <Plus className="size-4" />
        </Button>
      </div>
    </div>
  );
}

function AddProject() {
  const { customers } = useAppData();
  const [name, setName] = useState("");
  const [customerId, setCustomerId] = useState("");

  return (
    <div className="space-y-2 rounded-2xl border bg-card p-3">
      <Label className="text-xs">Neues Projekt</Label>
      <div className="flex gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Projektname" />
        <select
          value={customerId}
          onChange={(e) => setCustomerId(e.target.value)}
          className="h-9 rounded-md border bg-background px-2 text-sm"
          aria-label="Kunde"
        >
          <option value="">Kunde</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <Button
          onClick={() => {
            if (!name.trim()) return;
            saveProject({ id: newId(), name: name.trim(), customerId });
            setName("");
            toast.success("Projekt angelegt");
          }}
        >
          <Plus className="size-4" />
        </Button>
      </div>
    </div>
  );
}
