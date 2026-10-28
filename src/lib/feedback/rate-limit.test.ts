import { describe, expect, it } from "vitest";

import { createRateLimiter } from "./rate-limit";

const H = 3_600_000;
const cfg = { perUserPerHour: 5, perUserPerDay: 20, globalPerHour: 60 };

describe("in-memory rate limiter (best effort, per instance)", () => {
  it("allows 5 per hour per user, then limits with a retry-after", () => {
    const rl = createRateLimiter(cfg);
    const t0 = 1_700_000_000_000;
    for (let i = 0; i < 5; i += 1) expect(rl.consume("a", t0 + i).allowed).toBe(true);
    const d = rl.consume("a", t0 + 10);
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.retryAfterSeconds).toBeGreaterThan(3500);
  });

  it("another user is unaffected", () => {
    const rl = createRateLimiter(cfg);
    for (let i = 0; i < 5; i += 1) rl.consume("a", 1_000 + i);
    expect(rl.consume("a", 2_000).allowed).toBe(false);
    expect(rl.consume("b", 2_000).allowed).toBe(true);
  });

  it("the window slides: after an hour the user may send again", () => {
    const rl = createRateLimiter(cfg);
    for (let i = 0; i < 5; i += 1) rl.consume("a", 1_000);
    expect(rl.consume("a", 1_000 + H - 1).allowed).toBe(false);
    expect(rl.consume("a", 1_000 + H + 1).allowed).toBe(true);
  });

  it("20 per day: spread over several hours the 21st is refused", () => {
    const rl = createRateLimiter(cfg);
    const t0 = 5_000_000_000;
    for (let i = 0; i < 20; i += 1)
      expect(rl.consume("a", t0 + i * 20 * 60_000).allowed, String(i)).toBe(true);
    const d = rl.consume("a", t0 + 20 * 20 * 60_000);
    expect(d.allowed).toBe(false);
  });

  it("global cap protects the mailbox: many users, one hour", () => {
    const rl = createRateLimiter({ ...cfg, globalPerHour: 10 });
    for (let i = 0; i < 10; i += 1) expect(rl.consume(`u${i}`, 1_000 + i).allowed).toBe(true);
    expect(rl.consume("u99", 2_000).allowed).toBe(false);
    expect(rl.consume("u99", 1_000 + H + 10).allowed).toBe(true);
  });

  it("a refused request does not consume quota", () => {
    const rl = createRateLimiter({ ...cfg, perUserPerHour: 1 });
    expect(rl.consume("a", 1_000).allowed).toBe(true);
    for (let i = 0; i < 50; i += 1) rl.consume("a", 2_000 + i);
    expect(rl.consume("a", 1_000 + H + 1).allowed).toBe(true);
  });

  it("ignores stamps from the future (clock steps)", () => {
    const rl = createRateLimiter(cfg);
    for (let i = 0; i < 5; i += 1) rl.consume("a", 10 * H);
    expect(rl.consume("a", 1_000).allowed).toBe(true);
  });
});
