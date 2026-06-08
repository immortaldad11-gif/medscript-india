import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { rateLimit, RATE_LIMITS, type RateLimitRule } from "@/lib/rate-limit";
import { redis } from "@/lib/redis";

// Rate limiting — Section 3.2. This suite runs against the real Redis the limiter
// uses (started via `docker compose up`). It is written to pass in BOTH environments:
//   • Redis up   → asserts the enforcing path (allow up to the limit, then block).
//   • Redis down → asserts the documented dev "fail-open" degradation.
// It uses a unique bucket name so it never collides with real traffic or a prior run.

const RULE: RateLimitRule = { name: `test:rl:${Date.now()}`, limit: 3, windowSec: 30 };
const ID = "unit-test-client";
const KEY = `rl:${RULE.name}:${ID}`;

let redisUp = false;

before(async () => {
  if (!redis) return;
  try {
    await redis.ping();
    redisUp = true;
    await redis.del(KEY); // clean slate
  } catch {
    redisUp = false;
  }
});

after(async () => {
  if (redis && redisUp) {
    try {
      await redis.del(KEY);
    } catch {
      /* best-effort cleanup */
    }
  }
  if (redis) {
    try {
      await redis.quit();
    } catch {
      /* allow the test process to exit cleanly */
    }
  }
});

test("RATE_LIMITS presets are present and sane", () => {
  assert.equal(RATE_LIMITS.login.limit, 20);
  assert.equal(RATE_LIMITS.login.windowSec, 60);
  assert.equal(RATE_LIMITS.register.limit, 5);
  assert.equal(RATE_LIMITS.otp.windowSec, 300);
  for (const rule of Object.values(RATE_LIMITS)) {
    assert.ok(rule.limit > 0 && rule.windowSec > 0, "limit/window must be positive");
    assert.ok(typeof rule.name === "string" && rule.name.length > 0, "rule needs a name");
  }
});

test("allows up to the limit, then blocks with a Retry-After hint", async (t) => {
  if (!redisUp) {
    // Documented dev degradation: with no Redis the limiter fails open.
    for (let i = 0; i < RULE.limit + 2; i++) {
      const r = await rateLimit(RULE, ID);
      assert.equal(r.allowed, true, "fail-open: every call must be allowed when Redis is down");
    }
    t.diagnostic("Redis unavailable — asserted the fail-open path");
    return;
  }

  // The first `limit` calls are allowed and `remaining` counts down to 0.
  for (let i = 1; i <= RULE.limit; i++) {
    const r = await rateLimit(RULE, ID);
    assert.equal(r.allowed, true, `call ${i} (within limit) should be allowed`);
    assert.equal(r.remaining, RULE.limit - i, `remaining after call ${i}`);
    assert.equal(r.retryAfterSec, 0, "no retry hint while allowed");
  }

  // Subsequent calls are blocked, with a positive Retry-After inside the window.
  for (let i = 0; i < 2; i++) {
    const r = await rateLimit(RULE, ID);
    assert.equal(r.allowed, false, "over-limit call should be blocked");
    assert.equal(r.remaining, 0);
    assert.ok(r.retryAfterSec > 0 && r.retryAfterSec <= RULE.windowSec, "retryAfterSec within the window");
    assert.equal(r.limit, RULE.limit);
  }
});

test("counters are isolated per identifier", async (t) => {
  if (!redisUp) {
    t.skip("requires Redis");
    return;
  }
  const otherId = "different-client";
  const otherKey = `rl:${RULE.name}:${otherId}`;
  try {
    // A fresh identifier gets a full allowance even though ID is exhausted above.
    const r = await rateLimit(RULE, otherId);
    assert.equal(r.allowed, true);
    assert.equal(r.remaining, RULE.limit - 1);
  } finally {
    if (redis) {
      try {
        await redis.del(otherKey);
      } catch {
        /* best-effort cleanup */
      }
    }
  }
});
