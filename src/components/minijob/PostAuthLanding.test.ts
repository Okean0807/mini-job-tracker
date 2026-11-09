/**
 * Behavioural tests (real TanStack router, memory history): where the user lands after a
 * Google sign-in, after finishing the setup wizard, and that none of it can loop.
 */
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, createElement, Fragment, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthSessionStatus } from "@/lib/minijob/auth-session";
import {
  OAUTH_LANDING_KEY,
  OAUTH_LANDING_MAX_AGE_MS,
  isOAuthLandingPending,
  markOAuthLanding,
} from "@/lib/minijob/post-auth-landing";

import { PostAuthLanding } from "./PostAuthLanding";
import { useWizardDone } from "./use-wizard-done";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Inputs = { authStatus: AuthSessionStatus; restorePending: boolean };

let host: HTMLDivElement;
let root: Root;
let setInputs: (next: Inputs) => void;
let onSettled: ReturnType<typeof vi.fn>;
let doneCallback: (() => void) | undefined;
let hideWizard: ReturnType<typeof vi.fn>;

beforeEach(() => {
  window.sessionStorage.clear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  onSettled = vi.fn();
  hideWizard = vi.fn();
  doneCallback = undefined;
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function DoneProbe() {
  doneCallback = useWizardDone(hideWizard as unknown as () => void);
  return null;
}

async function mount(initialPath: string, initial: Inputs) {
  function Layout() {
    const [inputs, set] = useState(initial);
    setInputs = set;
    return createElement(
      Fragment,
      null,
      createElement(PostAuthLanding, {
        authStatus: inputs.authStatus,
        restorePending: inputs.restorePending,
        onSettled: onSettled as unknown as () => void,
      }),
      createElement(DoneProbe),
      createElement(Outlet),
    );
  }
  const rootRoute = createRootRoute({ component: Layout });
  const page = (name: string) => () => createElement("main", { "data-page": name }, name);
  const router = createRouter({
    routeTree: rootRoute.addChildren(
      ["/", "/einstellungen", "/impressum", "/rechtliches"].map((path) =>
        createRoute({ getParentRoute: () => rootRoute, path, component: page(path) }),
      ),
    ),
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });
  await act(async () => {
    root.render(createElement(RouterProvider, { router }));
    await router.load();
  });
  return router;
}

async function update(next: Inputs) {
  await act(async () => {
    setInputs(next);
    await new Promise((r) => setTimeout(r, 0));
  });
}

const signedIn: Inputs = { authStatus: "signed_in", restorePending: false };

describe("after Google sign-in", () => {
  it("existing user with a completed profile ends on '/' (not on settings)", async () => {
    markOAuthLanding();
    const router = await mount("/einstellungen", { authStatus: "loading", restorePending: false });
    expect(router.state.location.pathname).toBe("/einstellungen"); // session unknown: no early move
    await update(signedIn);
    expect(router.state.location.pathname).toBe("/");
    expect(isOAuthLandingPending()).toBe(false);
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it("waits for the first profile restore, then moves home exactly once", async () => {
    markOAuthLanding();
    const router = await mount("/einstellungen", { authStatus: "signed_in", restorePending: true });
    expect(router.state.location.pathname).toBe("/einstellungen");
    expect(isOAuthLandingPending()).toBe(true);
    await update({ authStatus: "signed_in", restorePending: false });
    expect(router.state.location.pathname).toBe("/");
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it("does not loop: later renders and an explicit visit to settings stay where they are", async () => {
    markOAuthLanding();
    const router = await mount("/einstellungen", signedIn);
    expect(router.state.location.pathname).toBe("/");
    await update({ authStatus: "signed_in", restorePending: true });
    await update(signedIn);
    expect(router.state.location.pathname).toBe("/");
    await act(async () => {
      await router.navigate({ to: "/einstellungen" });
    });
    await update(signedIn);
    expect(router.state.location.pathname).toBe("/einstellungen"); // explicit navigation is respected
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it("a cancelled or failed sign-in clears the marker and leaves the page alone", async () => {
    markOAuthLanding();
    const router = await mount("/einstellungen", { authStatus: "loading", restorePending: false });
    await update({ authStatus: "signed_out", restorePending: false });
    expect(router.state.location.pathname).toBe("/einstellungen");
    expect(isOAuthLandingPending()).toBe(false);
  });

  it("session restore on '/' (marker present) clears it without navigating", async () => {
    markOAuthLanding();
    const router = await mount("/", { authStatus: "loading", restorePending: false });
    await update(signedIn);
    expect(router.state.location.pathname).toBe("/");
    expect(isOAuthLandingPending()).toBe(false);
  });
});

describe("settings are only opened on purpose", () => {
  it("without a sign-in marker a signed-in user stays on /einstellungen", async () => {
    const router = await mount("/einstellungen", signedIn);
    expect(router.state.location.pathname).toBe("/einstellungen");
    expect(onSettled).not.toHaveBeenCalled();
  });

  it("a marker of an abandoned sign-in is ignored", async () => {
    window.sessionStorage.setItem(
      OAUTH_LANDING_KEY,
      String(Date.now() - OAUTH_LANDING_MAX_AGE_MS - 1000),
    );
    const router = await mount("/einstellungen", signedIn);
    expect(router.state.location.pathname).toBe("/einstellungen");
  });
});

describe("legal navigation is not hijacked", () => {
  it("a legal page open while a marker exists is neither left nor redirected", async () => {
    markOAuthLanding();
    const router = await mount("/impressum", signedIn);
    expect(router.state.location.pathname).toBe("/impressum");
    expect(isOAuthLandingPending()).toBe(false);
    await act(async () => {
      await router.navigate({ to: "/rechtliches" });
    });
    expect(router.state.location.pathname).toBe("/rechtliches");
  });
});

describe("finishing the setup wizard", () => {
  it("hides the wizard and lands on '/' even if the wizard was opened on /einstellungen", async () => {
    const router = await mount("/einstellungen", signedIn);
    expect(doneCallback).toBeTypeOf("function");
    await act(async () => {
      doneCallback!();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(hideWizard).toHaveBeenCalledTimes(1);
    expect(router.state.location.pathname).toBe("/");
  });

  it("is a no-op navigation when already on '/'", async () => {
    const router = await mount("/", signedIn);
    await act(async () => {
      doneCallback!();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(router.state.location.pathname).toBe("/");
    expect(hideWizard).toHaveBeenCalledTimes(1);
  });
});
