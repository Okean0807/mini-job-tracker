/**
 * Echter Render-Test (react-dom/client + act, happy-dom; keine neue Dependency):
 * Ein Konto-/Scope-Wechsel mountet den Inhalt von <ScopeBoundary> neu, lokaler
 * State (z. B. halb ausgefüllter Schicht-Dialog) wird verworfen.
 */
import { act, createElement, useEffect, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ScopeBoundary } from "./ScopeBoundary";
import { activateScope, loadFromStorage } from "@/lib/minijob/store";
import { DEMO_SCOPE, GUEST_SCOPE, userScope } from "@/lib/minijob/storage-scope";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let mounts = 0;
let unmounts = 0;
let bump: (() => void) | null = null;

/** Steht für eine Seite mit offenem Dialog: zählt Mounts, hält lokalen State. */
function Probe() {
  const [draft, setDraft] = useState(0);
  bump = () => setDraft((d) => d + 1);
  useEffect(() => {
    mounts += 1;
    return () => {
      unmounts += 1;
    };
  }, []);
  return createElement("span", { "data-testid": "draft" }, String(draft));
}

let container: HTMLDivElement;
let root: Root;

function render(node: ReactNode) {
  act(() => root.render(node));
}

function draftText() {
  return container.querySelector('[data-testid="draft"]')?.textContent;
}

function clearAppKeys() {
  for (let i = window.localStorage.length - 1; i >= 0; i -= 1) {
    const key = window.localStorage.key(i);
    if (key?.startsWith("minijob-")) window.localStorage.removeItem(key);
  }
}

beforeEach(() => {
  clearAppKeys();
  loadFromStorage();
  act(() => {
    activateScope(userScope("user-a"));
  });
  mounts = 0;
  unmounts = 0;
  bump = null;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("ScopeBoundary (key={scope})", () => {
  it("Scope-Wechsel A → B → Testmodus → Gast: Remount, lokaler State zurückgesetzt", () => {
    render(createElement(ScopeBoundary, null, createElement(Probe)));
    expect(mounts).toBe(1);
    act(() => bump!());
    act(() => bump!());
    expect(draftText()).toBe("2");

    act(() => {
      activateScope(userScope("user-b"));
    });
    expect(unmounts).toBe(1);
    expect(mounts).toBe(2);
    expect(draftText()).toBe("0");

    act(() => bump!());
    expect(draftText()).toBe("1");
    act(() => {
      activateScope(DEMO_SCOPE);
    });
    expect(mounts).toBe(3);
    expect(draftText()).toBe("0");

    act(() => {
      activateScope(GUEST_SCOPE);
    });
    expect(mounts).toBe(4);
    expect(draftText()).toBe("0");
  });

  it("ohne Scope-Wechsel (gleicher Scope erneut aktiviert / Datenänderung): kein Remount", () => {
    render(createElement(ScopeBoundary, null, createElement(Probe)));
    act(() => bump!());
    act(() => {
      activateScope(userScope("user-a"));
    });
    expect(mounts).toBe(1);
    expect(draftText()).toBe("1");
  });

  it("Kontrolle: ohne ScopeBoundary bleibt der State über den Wechsel erhalten (Test ist sensitiv)", () => {
    render(createElement(Probe));
    act(() => bump!());
    act(() => {
      activateScope(userScope("user-b"));
    });
    expect(mounts).toBe(1);
    expect(draftText()).toBe("1");
  });
});
