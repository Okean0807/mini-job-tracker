import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { BarChart3, Bot, Briefcase, CalendarDays, FileText, Settings } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { toast } from "sonner";

import { Toaster } from "@/components/ui/sonner";
import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { PinLock } from "@/components/minijob/PinLock";
import { OnboardingWizard } from "@/components/minijob/OnboardingWizard";
import { shouldShowOnboardingWizard } from "@/lib/minijob/wizard-flow";
import { useAuthSession } from "@/hooks/use-auth-session";
import {
  isFailedOAuthCallback,
  OAUTH_EXCHANGE_GRACE_MS,
  readOAuthCallback,
  stripOAuthParams,
} from "@/lib/minijob/oauth-callback";
import {
  OAUTH_HANDOFF_PARAM,
  readOAuthHandoff,
  signInWithOAuthProvider,
} from "@/lib/minijob/oauth-sign-in";
import { initCloudSync, useSyncState } from "../lib/minijob/cloud";
import { initNotifications } from "../lib/minijob/notify";
import {
  getData,
  isPersistFailed,
  loadFromStorage,
  onPersistError,
  useAppData,
} from "../lib/minijob/store";
import { useT } from "@/lib/i18n";
import { applyAppearance } from "../lib/minijob/theme";
import { visible, type Feature } from "../lib/minijob/uimode";
import type { UiMode } from "../lib/minijob/types";
import { registerServiceWorker } from "../lib/pwa";

function NotFoundComponent() {
  const { t } = useT();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">{t("error.notFoundTitle")}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{t("error.notFoundHint")}</p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {t("error.toHome")}
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  const { t } = useT();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{t("error.pageLoad")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("error.pageLoadHint")}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {t("action.retry")}
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            {t("error.toHome")}
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { name: "theme-color", content: "#0f766e" },
      { name: "author", content: "MiniJob Tracker" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "MiniJob Tracker – Arbeitszeiten & Verdienst erfassen" },
      { property: "og:title", content: "MiniJob Tracker – Arbeitszeiten & Verdienst erfassen" },
      { name: "twitter:title", content: "MiniJob Tracker – Arbeitszeiten & Verdienst erfassen" },
      { name: "description", content: "Arbeitszeiten per Timer oder Kalender erfassen, Zuschläge und Verdienst automatisch berechnen – mit Jobs, Statistiken und Export." },
      { property: "og:description", content: "Arbeitszeiten per Timer oder Kalender erfassen, Zuschläge und Verdienst automatisch berechnen – mit Jobs, Statistiken und Export." },
      { name: "twitter:description", content: "Arbeitszeiten per Timer oder Kalender erfassen, Zuschläge und Verdienst automatisch berechnen – mit Jobs, Statistiken und Export." },
      { property: "og:image", content: "https://storage.googleapis.com/gpt-engineer-file-uploads/attachments/og-images/060d78ae-9232-45ed-bd88-7de649204a2e" },
      { name: "twitter:image", content: "https://storage.googleapis.com/gpt-engineer-file-uploads/attachments/og-images/060d78ae-9232-45ed-bd88-7de649204a2e" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap",
      },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/icons/icon-192.png" },
      { rel: "icon", type: "image/png", href: "/favicon.png" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="de">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

const NAV: {
  to: string;
  labelKey: string;
  icon: typeof CalendarDays;
  feature?: Feature;
}[] = [
  { to: "/", labelKey: "nav.overview", icon: CalendarDays },
  { to: "/statistik", labelKey: "nav.stats", icon: BarChart3, feature: "nav.stats" },
  { to: "/jobs", labelKey: "nav.jobs", icon: Briefcase, feature: "nav.jobs" },
  { to: "/dokumente", labelKey: "nav.docs", icon: FileText, feature: "nav.docs" },
  { to: "/assistent", labelKey: "nav.ai", icon: Bot, feature: "nav.ai" },
  { to: "/einstellungen", labelKey: "nav.settings", icon: Settings },
];

function BottomNav({ uiMode }: { uiMode: UiMode }) {
  const { t } = useT();
  const items = NAV.filter((n) => !n.feature || visible(n.feature, uiMode));
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 backdrop-blur">
      <ul className="mx-auto flex max-w-lg">
        {items.map(({ to, labelKey, icon: Icon }) => {
          const label = t(labelKey);
          return (
            <li key={to} className="min-w-0 flex-1">
              <Link
                to={to}
                title={label}
                aria-label={label}
                activeOptions={{ exact: to === "/" }}
                activeProps={{ className: "text-primary" }}
                inactiveProps={{ className: "text-muted-foreground" }}
                className="flex min-h-11 min-w-0 flex-col items-center justify-center gap-0.5 px-0.5 py-2 text-[11px] font-medium leading-tight"
              >
                <Icon className="size-5 shrink-0" aria-hidden />
                <span className="nav-label w-full overflow-hidden text-center text-ellipsis whitespace-nowrap break-normal">
                  {label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * Konflikte/Fehler beim Cloud-Abgleich sichtbar machen: sonst stoppt das
 * automatische Backup still und der Hinweis wäre nur in den Einstellungen zu
 * sehen.
 */
function SyncAlerts() {
  const { t } = useT();
  const { status, message } = useSyncState();
  const previous = useRef(status);

  useEffect(() => {
    if (previous.current === status) return;
    previous.current = status;
    if (status === "conflict") {
      toast.warning(t("set.account.cloud.sync.conflict"), { id: "sync-conflict" });
    } else if (status === "error") {
      toast.error(message ?? t("set.account.cloud.sync.error"), { id: "sync-error" });
    }
  }, [status, message, t]);

  return null;
}

/**
 * OAuth-Rückkehr sichtbar machen und den Embed-Handoff abschließen.
 *
 * Ohne das scheitert eine Registrierung still: supabase-js tauscht `?code=`
 * selbst, meldet aber nichts, wenn der PKCE-Verifier fehlt — der Nutzer bleibt
 * ohne Session und ohne Hinweis stehen.
 */
function AuthCallback() {
  const { t } = useT();
  const { status } = useAuthSession();
  const statusRef = useRef(status);
  const reported = useRef(false);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  // Tab, den die eingebettete App geöffnet hat: hier läuft OAuth top-level.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (readOAuthHandoff(window.location.search) !== "google") return;
    if (status === "loading") return;
    const url = new URL(window.location.href);
    url.searchParams.delete(OAUTH_HANDOFF_PARAM);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    if (status === "signed_out") void signInWithOAuthProvider("google");
  }, [status]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const info = readOAuthCallback(window.location.search);
    if (reported.current || (!info.hasCode && !info.error)) return;

    const report = () => {
      reported.current = true;
      toast.error(t("error.oauthCallback"), { id: "oauth-callback", duration: 8000 });
      window.history.replaceState(null, "", stripOAuthParams(window.location.href));
    };

    if (info.error) {
      report();
      return;
    }
    // Der Code-Tausch läuft asynchron; erst danach ist "keine Session" ein Fehler.
    const timer = setTimeout(() => {
      const current = readOAuthCallback(window.location.search);
      if (isFailedOAuthCallback(current, statusRef.current)) report();
    }, OAUTH_EXCHANGE_GRACE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [status, t]);

  return null;
}

/**
 * Lokales Speichern kann fehlschlagen (voller Speicher, Privatmodus). Ohne
 * Hinweis hielte der Nutzer die Eingabe für gesichert.
 */
function StorageAlert() {
  const { t } = useT();

  useEffect(() => {
    const show = (failed: boolean) => {
      if (failed) toast.error(t("error.storage"), { id: "storage-error", duration: 10000 });
    };
    show(isPersistFailed());
    const unsubscribe = onPersistError(show);
    return () => {
      unsubscribe();
    };
  }, [t]);

  return null;
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  const { settings, jobs } = useAppData();
  const [ready, setReady] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [showWizard, setShowWizard] = useState(false);

  useEffect(() => {
    try {
      loadFromStorage();
      const data = getData();
      const loaded = data.settings;
      applyAppearance(loaded);
      initCloudSync();
      initNotifications();
      registerServiceWorker();
      setUnlocked(!(loaded.pinEnabled && loaded.pin));
      setShowWizard(shouldShowOnboardingWizard(loaded, data.jobs));
    } catch (error) {
      console.error("[root] bootstrap failed", error);
    } finally {
      // Always unblock the Outlet — a cloud/supabase failure must not blank the app.
      setReady(true);
    }
  }, []);

  // Cloud restore of a completed profile (isWizardComplete) after Google —
  // close the wizard so returning users reach Dashboard. Incomplete / Skip-era /
  // empty backups stay incomplete so new users stay in the wizard (Work Mode…).
  useEffect(() => {
    setShowWizard(shouldShowOnboardingWizard(settings, jobs));
  }, [settings.onboarded, settings.wizardCompletedAt, jobs]);

  useEffect(() => {
    applyAppearance(settings);
  }, [
    settings.themeMode,
    settings.accent,
    settings.textSize,
    settings.touchSize,
    settings.highContrast,
    settings.reduceMotion,
    settings.uiMode,
  ]);

  const locked = ready && settings.pinEnabled && Boolean(settings.pin) && !unlocked;

  return (
    <QueryClientProvider client={queryClient}>
      <div className="app-shell min-h-screen pb-28">{ready ? <Outlet /> : null}</div>

      {/* Hide nav under wizard/PIN overlays (z-40 under z-60) and while bootstrapping */}
      {ready && !showWizard && !locked ? <BottomNav uiMode={settings.uiMode} /> : null}
      {locked ? <PinLock settings={settings} onUnlock={() => setUnlocked(true)} /> : null}
      {ready && showWizard && !locked ? (
        <OnboardingWizard settings={settings} onDone={() => setShowWizard(false)} />
      ) : null}
      <SyncAlerts />
      <StorageAlert />
      <AuthCallback />
      <Toaster position="top-center" />
    </QueryClientProvider>
  );
}
