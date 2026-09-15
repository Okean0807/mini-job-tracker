import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { authSessionStatus, bindAuthSession } from "@/lib/minijob/auth-session";
import type { Session } from "@supabase/supabase-js";

function fakeSession(email: string): Session {
  return {
    access_token: "a",
    refresh_token: "r",
    expires_in: 3600,
    token_type: "bearer",
    user: {
      id: "u1",
      email,
      aud: "authenticated",
      app_metadata: {},
      user_metadata: {},
      created_at: "",
    },
  } as Session;
}

describe("authSessionStatus transitions", () => {
  it("stays loading until phase is ready (null is not signed_out yet)", () => {
    expect(authSessionStatus("pending", null)).toBe("loading");
    expect(authSessionStatus("pending", fakeSession("a@b.c"))).toBe("loading");
  });

  it("maps ready+session → signed_in and ready+null → signed_out", () => {
    expect(authSessionStatus("ready", fakeSession("a@b.c"))).toBe("signed_in");
    expect(authSessionStatus("ready", null)).toBe("signed_out");
  });
});

describe("useAuthSession wiring", () => {
  const root = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(root, "use-auth-session.ts"), "utf8");

  it("wraps bindAuthSession and soft-fails to signed_out", () => {
    expect(src).toMatch(/bindAuthSession\(supabase,/);
    expect(src).toMatch(/authSessionStatus\(phase,\s*session\)/);
    expect(src).toMatch(/\[useAuthSession\] Supabase auth unavailable/);
    expect(src).toMatch(/setPhase\("ready"\)/);
  });

  it("starts pending so first null from bind is the only path to signed_out", () => {
    expect(src).toMatch(/useState<"pending" \| "ready">\("pending"\)/);
  });
});

describe("bindAuthSession → status transition sequence", () => {
  it("pending → signed_in when hydrate yields a session", async () => {
    const s = fakeSession("x@y.z");
    const getSession = vi.fn().mockResolvedValue({ data: { session: s }, error: null });
    const onAuthStateChange = vi.fn(() => ({
      data: { subscription: { unsubscribe: vi.fn() } },
    }));

    let phase: "pending" | "ready" = "pending";
    let session: Session | null = null;
    const statuses: string[] = [authSessionStatus(phase, session)];

    bindAuthSession({ auth: { getSession, onAuthStateChange } } as never, (next) => {
      session = next;
      phase = "ready";
      statuses.push(authSessionStatus(phase, session));
    });

    await vi.waitFor(() => expect(statuses).toContain("signed_in"));
    expect(statuses[0]).toBe("loading");
    expect(statuses.at(-1)).toBe("signed_in");
  });

  it("pending → signed_out when hydrate yields null", async () => {
    const getSession = vi.fn().mockResolvedValue({ data: { session: null }, error: null });
    const onAuthStateChange = vi.fn(() => ({
      data: { subscription: { unsubscribe: vi.fn() } },
    }));

    let phase: "pending" | "ready" = "pending";
    let session: Session | null = null;
    const statuses: string[] = [authSessionStatus(phase, session)];

    bindAuthSession({ auth: { getSession, onAuthStateChange } } as never, (next) => {
      session = next;
      phase = "ready";
      statuses.push(authSessionStatus(phase, session));
    });

    await vi.waitFor(() => expect(statuses).toContain("signed_out"));
    expect(statuses[0]).toBe("loading");
    expect(statuses.at(-1)).toBe("signed_out");
  });
});
