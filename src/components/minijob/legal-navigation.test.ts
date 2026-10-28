/**
 * Regression tests for the legal-link navigation (Android report: links on wizard step 2 did
 * nothing, no back button on /impressum, links lost after returning to the AI page).
 *
 * Root causes covered here:
 *  1. __root rendered the onboarding wizard (fixed, z-60) above every route, so a legal page
 *     opened underneath it — and the links were plain anchors that reloaded the document.
 *  2. The legal pages had no back control.
 *  3. Legal links were scattered (plain anchors in 3 places, two of them inside conditional
 *     sections) instead of one concept.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { createElement, useState } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LegalLinks } from "@/components/minijob/LegalLinks";
import { LegalPageShell } from "@/components/minijob/LegalPageShell";
import { isLegalPath } from "@/lib/minijob/legal-links";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/** A start screen with in-memory state (like the wizard) + the shared legal links. */
function Start() {
  const [draft, setDraft] = useState("");
  return createElement(
    "div",
    null,
    createElement("input", {
      "data-testid": "draft",
      value: draft,
      onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
    }),
    createElement(LegalLinks, null),
  );
}

async function mount(initial = "/", start: () => ReturnType<typeof createElement> = Start) {
  const rootRoute = createRootRoute({ component: Outlet });
  const routes = [
    createRoute({ getParentRoute: () => rootRoute, path: "/", component: start }),
    ...["impressum", "datenschutz", "ki-hinweise"].map((name) =>
      createRoute({
        getParentRoute: () => rootRoute,
        path: `/${name}`,
        component: () =>
          createElement(LegalPageShell, null, createElement("h1", null, `page:${name}`)),
      }),
    ),
  ];
  const router = createRouter({
    routeTree: rootRoute.addChildren(routes),
    history: createMemoryHistory({ initialEntries: [initial] }),
  });
  await act(async () => {
    root.render(createElement(RouterProvider, { router }));
    await router.load();
  });
  return router;
}

const link = (name: string) =>
  [...host.querySelectorAll<HTMLAnchorElement>('[data-testid="legal-links"] a')].find(
    (a) => a.textContent === name,
  );

async function click(el: Element | null | undefined) {
  expect(el).toBeTruthy();
  await act(async () => {
    el!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe("LegalLinks click behaviour", () => {
  for (const [label, path] of [
    ["Impressum", "/impressum"],
    ["Datenschutz", "/datenschutz"],
    ["KI-Hinweise", "/ki-hinweise"],
  ] as const) {
    it(`${label}: navigates inside the app (no document reload), back button returns with state kept`, async () => {
      const router = await mount();
      const input = host.querySelector<HTMLInputElement>('[data-testid="draft"]')!;
      await act(async () => {
        input.value = "kept";
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      const a = link(label)!;
      expect(a.getAttribute("href")).toBe(path);
      expect(a.getAttribute("target")).toBeNull();
      const prevented = !a.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
      );
      expect(prevented).toBe(true); // handled by the router, the browser does not reload
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
      expect(router.state.location.pathname).toBe(path);
      expect(host.querySelector("h1")?.textContent).toBe(`page:${path.slice(1)}`);

      const back = host.querySelector<HTMLButtonElement>('[data-testid="legal-back"]');
      expect(back?.textContent).toContain("Zurück");
      await click(back);
      expect(router.state.location.pathname).toBe("/");
      expect(link(label)).toBeTruthy(); // links are still there after returning
    });
  }

  it("keeps a plain new-tab anchor only where explicitly requested (AI notice dialog)", () => {
    const html = read("src/components/minijob/AiNoticeDialog.tsx");
    expect(html).toMatch(/<LegalLinks newTab\b/);
    act(() => root.render(createElement(LegalLinks, { newTab: true })));
    const a = host.querySelector("a")!;
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toContain("noopener");
  });

  it("can be narrowed to one document and exposes accessible names", async () => {
    await mount("/", () => createElement(LegalLinks, { only: ["/ki-hinweise"] }));
    const links = [...host.querySelectorAll("a")];
    expect(links.map((a) => a.textContent)).toEqual(["KI-Hinweise"]);
    expect(host.querySelector("nav")?.getAttribute("aria-label")).toBe("Rechtliche Informationen");
  });
});

describe("LegalPageShell back control", () => {
  it("falls back to the start screen when the page was opened directly", async () => {
    const router = await mount("/impressum");
    await click(host.querySelector('[data-testid="legal-back"]'));
    expect(router.state.location.pathname).toBe("/");
  });

  it("is a real button (keyboard reachable) with an accessible name", async () => {
    await mount("/impressum");
    const back = host.querySelector<HTMLButtonElement>('[data-testid="legal-back"]')!;
    expect(back.tagName).toBe("BUTTON");
    expect(back.getAttribute("type")).toBe("button");
    expect(back.textContent?.trim()).toBe("Zurück");
    expect(back.disabled).toBe(false);
  });
});

describe("root cause 1: the wizard overlay must not cover the legal routes", () => {
  it("isLegalPath matches exactly the three public documents", () => {
    for (const p of ["/impressum", "/datenschutz", "/ki-hinweise", "/impressum/"]) {
      expect(isLegalPath(p)).toBe(true);
    }
    for (const p of ["/", "/assistent", "/einstellungen", "/impressum-x", "/jobs"]) {
      expect(isLegalPath(p)).toBe(false);
    }
  });

  it("__root hides (not unmounts) the wizard on legal routes", () => {
    const rootSrc = read("src/routes/__root.tsx");
    expect(rootSrc).toMatch(/isLegalPath\(\s*useRouterState/);
    expect(rootSrc).toMatch(/<div hidden=\{onLegalPage\}[^>]*>\s*[\s\S]*?<OnboardingWizard\b/);
    // never conditionally unmounted by route (that would reset wizard inputs)
    expect(rootSrc).not.toMatch(/showWizard\s*&&\s*!onLegalPage/);
  });
});

describe("placement concept", () => {
  it("settings has one 'Rechtliches' section, no stray anchors", () => {
    const src = read("src/routes/einstellungen.tsx");
    expect(src).toMatch(/<Section title="Rechtliches">\s*<LegalLinks variant="list"/);
    expect(src).toContain('id="rechtliches"');
    expect(src.match(/<LegalLinks\b/g)).toHaveLength(1);
    expect(src).not.toMatch(/href="\/(impressum|datenschutz|ki-hinweise)"/);
  });

  it("wizard cloud step keeps all three links before login", () => {
    const src = read("src/components/minijob/OnboardingWizard.tsx");
    expect(src).toMatch(/<LegalLinks className="pt-1" \/>/);
  });

  it("AI page: KI-Hinweise + link to Rechtliches near the top, not at the end of the chat", () => {
    const src = read("src/routes/assistent.tsx");
    const row = src.indexOf('data-testid="ai-legal-links"');
    expect(row).toBeGreaterThan(0);
    expect(row).toBeLessThan(src.indexOf("{SUGGESTIONS.map"));
    expect(src).toMatch(/<LegalLinks only=\{\["\/ki-hinweise"\]\}/);
    expect(src).toMatch(/to="\/einstellungen"\s+hash="rechtliches"/);
    expect(src).not.toMatch(/<LegalLinks className="pb-24/);
  });

  it("every legal page uses the shared shell (back button) and no raw <main>", () => {
    for (const f of ["impressum", "datenschutz", "ki-hinweise"]) {
      const src = read(`src/routes/${f}.tsx`);
      expect(src).toContain("<LegalPageShell>");
      expect(src).not.toContain("<main");
    }
  });
});
