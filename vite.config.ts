// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only; default target cloudflare unless overridden), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
//
// Gate A (independent Vercel Preview): explicit nitro.preset = "vercel" for builds outside the
// Lovable sandbox. Inside Lovable sandbox the config still forces cloudflare-module — that is
// expected; see docs/VERCEL_PREVIEW.md.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { VitePWA } from "vite-plugin-pwa";
import type { ConfigEnv, Plugin } from "vite";
import {
  enforceProfileForViteCommand,
  resolveViteBuildProfile,
} from "./src/lib/cloud/build-profile.mjs";
import { loadEnvFileViewsSync } from "./src/lib/cloud/env-files.mjs";

// Build profile (P1 / P1.1).
// With an explicit MJC_BUILD_PROFILE (process.env or any .env file) the full validation runs here
// (invalid configuration throws, names only), the profile decides the baked VITE_CLOUD_SYNC_ENABLED
// and whether SUPABASE_* is bridged to VITE_* (never in public-local).
// FAIL-CLOSED per Vite command: the plugin below runs in Vite's `config` hook, which knows the real
// command. Only `serve` (editor `vite dev`) may run without a profile; `vite build` in ANY mode
// (also --mode development) and any unknown command is refused without one. This sits in the
// config, not in an npm script, so a direct `vite build` cannot bypass the gate.
const profileDecision = resolveViteBuildProfile(process.env, loadEnvFileViewsSync(process.cwd()));
if (profileDecision.kind === "profile") {
  for (const [name, value] of Object.entries(profileDecision.overrides)) {
    process.env[name] = value;
  }
} else {
  // Dev-server only (serve): legacy SUPABASE_* → VITE_* bridge when VITE_* is empty/missing.
  // Vite only statically replaces import.meta.env.VITE_* into client chunks;
  // Vercel often has SUPABASE_* for SSR while VITE_* was unset → empty bake.
  const url = process.env["VITE_SUPABASE_URL"]?.trim();
  if (!url && process.env["SUPABASE_URL"]?.trim()) {
    process.env["VITE_SUPABASE_URL"] = process.env["SUPABASE_URL"].trim();
  }
  const key = process.env["VITE_SUPABASE_PUBLISHABLE_KEY"]?.trim();
  if (!key && process.env["SUPABASE_PUBLISHABLE_KEY"]?.trim()) {
    process.env["VITE_SUPABASE_PUBLISHABLE_KEY"] = process.env["SUPABASE_PUBLISHABLE_KEY"].trim();
  }
}

const buildProfileGate: Plugin = {
  name: "mjc-build-profile-gate",
  enforce: "pre",
  config(_config: unknown, env: ConfigEnv) {
    enforceProfileForViteCommand(profileDecision, env.command);
  },
};

// Nitro vercel preset emits hashed client assets to .vercel/output/static (not Vite's dist).
// vite-plugin-pwa defaults globDirectory/swDest to vite.build.outDir (dist), so we remap outDir
// to the Nitro static root so generateSW precaches real production assets and ships /sw.js there.
const NITRO_VERCEL_STATIC = ".vercel/output/static";

export default defineConfig({
  nitro: {
    preset: "vercel",
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    plugins: [
      buildProfileGate,
      VitePWA({
        registerType: "autoUpdate",
        injectRegister: null,
        filename: "sw.js",
        outDir: NITRO_VERCEL_STATIC,
        // Public icons/manifest are copied by Nitro after client closeBundle; include them via
        // publicDir hashing so they still land in the precache manifest.
        includeAssets: ["favicon.png", "icons/**/*.png", "manifest.webmanifest"],
        devOptions: { enabled: false },
        manifest: false,
        workbox: {
          // Only hashed Vite client emit under assets/ — public icons/manifest come from
          // includeAssets (avoids duplicate entries when generateSW also runs after Nitro
          // copyPublicAssets).
          globPatterns: ["assets/**/*.{js,css,woff,woff2,svg,png,webp}"],
          // SSR app: do not bind navigations to a missing SPA index.html.
          navigateFallback: null,
          navigateFallbackDenylist: [/^\/~oauth/, /^\/api\//],
          runtimeCaching: [
            {
              urlPattern: ({ request }) => request.mode === "navigate",
              handler: "NetworkFirst",
              options: { cacheName: "pages" },
            },
            {
              urlPattern: ({ request, sameOrigin }) =>
                sameOrigin && ["style", "script", "image", "font"].includes(request.destination),
              handler: "CacheFirst",
              options: {
                cacheName: "assets",
                expiration: { maxEntries: 120, maxAgeSeconds: 60 * 60 * 24 * 30 },
              },
            },
          ],
        },
      }),
    ],
  },
});
