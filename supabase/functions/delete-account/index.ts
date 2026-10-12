import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { type AdminClientLike, handleDeleteAccount } from "./handler.ts";

// All logic lives in ./handler.ts (unit-tested with Vitest). This file only
// binds it to the Deno runtime and the server-side service-role client.
Deno.serve((req) =>
  handleDeleteAccount(req, {
    getEnv: (name) => Deno.env.get(name),
    createAdmin: (url, serviceRoleKey) =>
      createClient(url, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      }) as unknown as AdminClientLike,
  }),
);
