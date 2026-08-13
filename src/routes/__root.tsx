import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { BarChart3, Bot, Briefcase, CalendarDays, Settings } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { Toaster } from "@/components/ui/sonner";
import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { PinLock } from "@/components/minijob/PinLock";
import { OnboardingWizard } from "@/components/minijob/OnboardingWizard";
import { initCloudSync } from "../lib/minijob/cloud";
import { initNotifications } from "../lib/minijob/notify";
import { getData, loadFromStorage, useAppData } from "../lib/minijob/store";
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
  { to: "/assistent", labelKey: "nav.ai", icon: Bot, feature: "nav.ai" },
  { to: "/einstellungen", labelKey: "nav.settings", icon: Settings },
];

function BottomNav({ uiMode }: { uiMode: UiMode }) {
  const { t } = useT();
  const items = NAV.filter((n) => !n.feature || visible(n.feature, uiMode));
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 backdrop-blur">
      <ul className="mx-auto flex max-w-lg">
        {items.map(({ to, labelKey, icon: Icon }) => (
          <li key={to} className="flex-1">
            <Link
              to={to}
              activeOptions={{ exact: to === "/" }}
              activeProps={{ className: "text-primary" }}
              inactiveProps={{ className: "text-muted-foreground" }}
              className="flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium"
            >
              <Icon className="size-5" />
              {t(labelKey)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  const { settings } = useAppData();
  const [ready, setReady] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [showWizard, setShowWizard] = useState(false);

  useEffect(() => {
    loadFromStorage();
    const loaded = getData().settings;
    applyAppearance(loaded);
    initCloudSync();
    initNotifications();
    registerServiceWorker();
    setUnlocked(!(loaded.pinEnabled && loaded.pin));
    setShowWizard(!loaded.onboarded);
    setReady(true);
  }, []);

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
      <div className="min-h-screen pb-20">{ready ? <Outlet /> : null}</div>

      <BottomNav uiMode={settings.uiMode} />
      {locked ? <PinLock settings={settings} onUnlock={() => setUnlocked(true)} /> : null}
      {ready && showWizard && !locked ? (
        <OnboardingWizard settings={settings} onDone={() => setShowWizard(false)} />
      ) : null}
      <Toaster position="top-center" />
    </QueryClientProvider>
  );
}
