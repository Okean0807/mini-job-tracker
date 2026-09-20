import { createFileRoute } from "@tanstack/react-router";
import { Briefcase, Plus, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { JobDialog } from "@/components/minijob/JobDialog";
import { OrdersCard } from "@/components/minijob/OrdersCard";
import { ObjectsCard } from "@/components/minijob/ObjectsCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useT } from "@/lib/i18n";
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
import { canAddJob } from "@/lib/minijob/premium";
import { primaryWorkMode } from "@/lib/minijob/work-mode";
import { type Job } from "@/lib/minijob/types";

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
  const { t } = useT();
  const { jobs, customers, projects, payments, orders, objects, settings, shifts } = useAppData();
  const isSelf = primaryWorkMode(jobs, settings.activeJobId) === "selbststaendig";
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Job | null>(null);

  return (
    <main className="mx-auto max-w-lg px-4 pt-6">
      <h1 className="text-2xl font-extrabold tracking-tight">{t("job.pageTitle")}</h1>

      <div className="mt-4">
        <ObjectsCard objects={objects} />
      </div>

      {isSelf ? (
        <div className="mt-4 grid grid-cols-2 items-start gap-3">
          <OrdersCard orders={orders} jobs={jobs} payments={payments} />
        </div>
      ) : null}

      <Tabs defaultValue="jobs" className="mt-4">
        <TabsList className="w-full">
          <TabsTrigger value="jobs" className="flex-1">
            {t("job.tabJobs")}
          </TabsTrigger>
          <TabsTrigger value="kunden" className="flex-1">
            {t("job.tabCustomers")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="jobs" className="mt-4 space-y-3">
          {jobs.length === 0 ? (
            <div className="rounded-2xl border border-dashed p-8 text-center">
              <Briefcase className="mx-auto size-8 text-muted-foreground" />
              <p className="mt-3 text-sm text-muted-foreground">{t("job.empty")}</p>
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
                    {t("mode." + job.mode)} · {formatEuro(job.rate ?? settings.defaultRate)}
                    {t("job.perHour")}
                    {job.mode === "fest"
                      ? ` · ${t("job.hoursPerWeek", { hours: weeklyPlanHours(job).toFixed(1) })}`
                      : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t(count === 1 ? "job.entries_one" : "job.entries_other", { count })}
                    {settings.activeJobId === job.id ? t("job.activeSuffix") : ""}
                  </p>
                </div>
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    updateSettings({ activeJobId: job.id });
                    toast.success(t("job.setActiveToast", { name: job.name }));
                  }}
                  onKeyDown={(e) => e.stopPropagation()}
                  className="rounded-lg border px-2 py-1 text-xs"
                >
                  {t("job.setActive")}
                </span>
              </button>
            );
          })}

          <Button
            className="w-full"
            onClick={() => {
              if (!canAddJob(settings, jobs.length)) {
                toast.error(t("premium.title"), { description: t("premium.multiJob") });
                return;
              }
              setEditing(null);
              setOpen(true);
            }}
          >
            <Plus className="size-4" /> {t("job.add")}
            {!canAddJob(settings, jobs.length) ? (
              <span className="rounded-full bg-primary-foreground/20 px-2 py-0.5 text-[10px] font-semibold">
                {t("premium.badge")}
              </span>
            ) : null}
          </Button>
        </TabsContent>

        <TabsContent value="kunden" className="mt-4 space-y-4">
          <section className="space-y-3">
            <h2 className="text-sm font-semibold">{t("cust.title")}</h2>
            {customers.length === 0 ? (
              <div className="rounded-2xl border border-dashed p-6 text-center">
                <Users className="mx-auto size-7 text-muted-foreground" />
                <p className="mt-2 text-xs text-muted-foreground">{t("cust.empty")}</p>
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
                        <p className="text-xs text-muted-foreground">
                          {formatEuro(c.rate)}
                          {t("job.perHour")}
                        </p>
                      ) : null}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      onClick={() => deleteCustomer(c.id)}
                    >
                      {t("action.delete")}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <AddCustomer />
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold">{t("cust.projectsTitle")}</h2>
            <ul className="space-y-2">
              {projects.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between rounded-2xl border bg-card p-3"
                >
                  <div>
                    <p className="text-sm font-semibold">{p.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {customers.find((c) => c.id === p.customerId)?.name ?? t("cust.noCustomer")}
                      {p.rate ? ` · ${formatEuro(p.rate)}${t("job.perHour")}` : ""}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                    onClick={() => deleteProject(p.id)}
                  >
                    {t("action.delete")}
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
  const { t } = useT();
  const [name, setName] = useState("");
  const [rate, setRate] = useState("");

  return (
    <div className="space-y-2 rounded-2xl border bg-card p-3">
      <Label className="text-xs">{t("cust.newCustomer")}</Label>
      <div className="flex gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("cust.namePlaceholder")}
        />
        <Input
          className="w-24"
          type="number"
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          placeholder={t("cust.ratePlaceholder")}
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
            toast.success(t("cust.created"));
          }}
        >
          <Plus className="size-4" />
        </Button>
      </div>
    </div>
  );
}

function AddProject() {
  const { t } = useT();
  const { customers } = useAppData();
  const [name, setName] = useState("");
  const [customerId, setCustomerId] = useState("");

  return (
    <div className="space-y-2 rounded-2xl border bg-card p-3">
      <Label className="text-xs">{t("cust.newProject")}</Label>
      <div className="flex gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("cust.projectNamePlaceholder")}
        />
        <select
          value={customerId}
          onChange={(e) => setCustomerId(e.target.value)}
          className="h-9 rounded-md border bg-background px-2 text-sm"
          aria-label={t("cust.customerOption")}
        >
          <option value="">{t("cust.customerOption")}</option>
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
            toast.success(t("cust.projectCreated"));
          }}
        >
          <Plus className="size-4" />
        </Button>
      </div>
    </div>
  );
}
