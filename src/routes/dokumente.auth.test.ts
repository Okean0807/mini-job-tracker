import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "dokumente.tsx"), "utf8");

describe("Dokumente auth unify (dokumente.tsx)", () => {
  it("uses shared useAuthSession instead of getSession-then-subscribe", () => {
    expect(src).toMatch(/useAuthSession/);
    expect(src).not.toMatch(/getSession\(/);
    expect(src).not.toMatch(/onAuthStateChange/);
  });

  it("shows doc.signedOut only when signed_out (not while loading)", () => {
    const renderStart = src.indexOf("return (");
    const render = src.slice(renderStart);
    expect(render).toMatch(/authStatus === "loading"/);
    expect(render).toMatch(/authStatus === "signed_out"/);
    const loadingAt = render.indexOf('authStatus === "loading"');
    const signedOutBranchAt = render.indexOf('authStatus === "signed_out"');
    const signedOutAt = render.indexOf('t("doc.signedOutUploads")');
    expect(loadingAt).toBeGreaterThan(-1);
    expect(signedOutBranchAt).toBeGreaterThan(loadingAt);
    expect(signedOutAt).toBeGreaterThan(signedOutBranchAt);
  });

  it("renders a neutral skeleton while loading", () => {
    expect(src).toMatch(/Skeleton/);
    expect(src).toMatch(/aria-busy="true"/);
  });
});
