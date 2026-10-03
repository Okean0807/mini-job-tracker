import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("account deletion security contract", () => {
  const root = resolve(process.cwd());
  const client = readFileSync(resolve(root, "src/lib/minijob/account-delete.ts"), "utf8");
  const fn = readFileSync(resolve(root, "supabase/functions/delete-account/index.ts"), "utf8");

  it("invokes a dedicated server-side deletion function", () => {
    expect(client).toMatch(/functions\.invoke\(["']delete-account["']/);
    expect(fn).toMatch(/auth\.admin\.deleteUser\(user\.id\)/);
  });

  it("derives identity from the bearer token instead of accepting a caller user id", () => {
    expect(fn).toMatch(/admin\.auth\.getUser\(token\)/);
    expect(fn).not.toMatch(/req\.json\(\)/);
  });

  it("removes document files before deleting account rows", () => {
    expect(fn).toMatch(/storage\.from\(["']documents["']\)\.remove/);
    expect(fn).toMatch(/from\(table\)\.delete\(\)\.eq\(["']user_id["'], user\.id\)/);
    expect(fn).toMatch(/auth\.admin\.deleteUser\(user\.id\)/);
  });

  it("clears the matching local scope after server deletion", () => {
    expect(client).toMatch(/clearUserScopeLocalData\(userId\)/);
    expect(client).toMatch(/persistScopePointer\(GUEST_SCOPE\)/);
  });
});
