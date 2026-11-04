import { assertCloudEnabled } from "@/lib/cloud/cloud-mode";

import { supabase } from "./client";

/**
 * The ONLY way application code obtains the Supabase client (enforced by a static test).
 * In a Public Local build (cloud flag OFF) this throws before the lazy client is even created, so no
 * client, no auth listener, no session restore, no request can ever originate from the app.
 */
export function cloudClient(feature = "supabase"): typeof supabase {
  assertCloudEnabled(feature);
  return supabase;
}
