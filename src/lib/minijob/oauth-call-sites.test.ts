import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

describe("OAuth call sites (Vercel-safe)", () => {
  const files = [
    "routes/einstellungen.tsx",
    "components/minijob/OnboardingWizard.tsx",
  ];

  for (const rel of files) {
    it(`${rel} uses supabase helper, not Lovable /~oauth/initiate broker`, () => {
      const src = readFileSync(join(root, rel), "utf8");
      expect(src).toMatch(/signInWithOAuthProvider/);
      expect(src).not.toMatch(/lovable\.auth\.signInWithOAuth/);
      expect(src).not.toMatch(/~oauth\/initiate/);
      expect(src).not.toMatch(/oauth\("apple"\)/);
      expect(src).not.toMatch(/signInWithOAuthProvider\("apple"/);
    });
  }
});
