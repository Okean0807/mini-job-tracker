// Pinned to the version in bun.lock (same as delete-account).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.3";

import { type UploadAdminLike, handleUploadDocument } from "./handler.ts";

// All logic lives in ./handler.ts (unit-tested with Vitest). This file only
// binds it to the Deno runtime and the server-side service-role client.
Deno.serve((req) =>
  handleUploadDocument(req, {
    getEnv: (name) => Deno.env.get(name),
    createAdmin: (url, serviceRoleKey) =>
      createClient(url, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      }) as unknown as UploadAdminLike,
    now: () => Date.now(),
    uuid: () => crypto.randomUUID(),
    log: { error: (event, fields) => console.error(JSON.stringify({ event, ...fields })) },
  }),
);
