import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const alias = {
  "@": fileURLToPath(new URL("./src", import.meta.url)),
};

// The existing suite exercises the cloud-enabled code paths (account scopes, sync, backups, premium gating).
// Phase 2 made those paths conditional on the baked build flag, so the suite runs as a "cloud-enabled"
// build by default; Public Local behaviour is tested explicitly with vi.stubEnv("VITE_CLOUD_SYNC_ENABLED", "false")
// (see src/lib/cloud/public-local-isolation.test.ts) and by the real Public Local build + browser runs.
const CLOUD_BUILD_ENV = { VITE_CLOUD_SYNC_ENABLED: "true" };

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          environment: "happy-dom",
          include: ["src/**/*.test.ts"],
          exclude: ["src/**/*.tz-la.test.ts"],
          env: CLOUD_BUILD_ENV,
        },
      },
      {
        resolve: { alias },
        test: {
          name: "tz-la",
          environment: "happy-dom",
          include: ["src/**/*.tz-la.test.ts"],
          env: { TZ: "America/Los_Angeles", ...CLOUD_BUILD_ENV },
        },
      },
    ],
  },
});
