import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const alias = {
  "@": fileURLToPath(new URL("./src", import.meta.url)),
};

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
        },
      },
      {
        resolve: { alias },
        test: {
          name: "tz-la",
          environment: "happy-dom",
          include: ["src/**/*.tz-la.test.ts"],
          env: { TZ: "America/Los_Angeles" },
        },
      },
    ],
  },
});
