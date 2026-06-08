import { NextResponse } from "next/server";
import { redis, redisAvailable } from "@/lib/redis";
import { clientIp } from "@/lib/audit";
import { fail } from "@/lib/http";

// Rate limiting — Section 3.2. Redis-backed fixed-window counters that throttle the
// abuse-prone PUBLIC endpoints (login, registration, OTP requests) per client identity.
//
// Degradation mirrors the rest of the codebase's "Redis is optional in dev" stance
// (see redis.ts): when Redis is unreachable the limiter FAILS OPEN — it allows the
// request so the app still runs without `docker compose up`. In production Redis is
// part of the deployment, so the control is always active. A failed Redis call mid-
// request also fails open (never let a cache hiccup take down authentication), but is
// logged so the gap is visible.

const PREFIX = "rl:";

export interface RateLimitRule {
  /** Logical bucket name; namespaces the counter, e.g. "auth:login". */
  name: string;
  /** Maximum requests permitted within the window. */
  limit: number;
  /** Window length in seconds. */
  windowSec: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Requests still permitted in the current window (0 once blocked). */
  remaining: number;
  /** Seconds until the window resets — the Retry-After hint. */
  retryAfterSec: number;
  limit: number;
}

// Centralised limits so they are easy to find and tune. Login is the most forgiving
// because legitimate clinics share a NAT IP across many staff, and per-account brute
// force is already covered by the 5-attempt lockout in the login route — this limit is
// the coarse per-IP credential-stuffing / DoS guard. Registration and OTP issuance are
// rare for a real user, so they are tighter.
export const RATE_LIMITS = {
  login: { name: "auth:login", limit: 20, windowSec: 60 },
  register: { name: "auth:register", limit: 5, windowSec: 60 },
  otp: { name: "auth:otp", limit: 5, windowSec: 300 },
} satisfies Record<string, RateLimitRule>;

// Fixed-window counter: INCR the key, set the TTL on its first hit. Fixed-window can
// allow a small burst across a window boundary, which is an acceptable trade for abuse
// throttling and keeps the implementation to one round-trip in the common case.
export async function rateLimit(rule: RateLimitRule, identifier: string): Promise<RateLimitResult> {
  const allowAll: RateLimitResult = { allowed: true, remaining: rule.limit, retryAfterSec: 0, limit: rule.limit };
  if (!redisAvailable() || !redis) return allowAll; // fail-open when Redis is down (dev)

  const key = `${PREFIX}${rule.name}:${identifier}`;
  try {
    const count = await redis.incr(key);
    let ttl = count === 1 ? (await redis.expire(key, rule.windowSec), rule.windowSec) : await redis.ttl(key);
    if (ttl < 0) {
      // Key exists without an expiry (e.g. a crash between INCR and EXPIRE) — self-heal.
      await redis.expire(key, rule.windowSec);
      ttl = rule.windowSec;
    }
    const allowed = count <= rule.limit;
    return {
      allowed,
      remaining: Math.max(0, rule.limit - count),
      retryAfterSec: allowed ? 0 : ttl,
      limit: rule.limit,
    };
  } catch (err) {
    console.warn("[rate-limit] check failed, allowing request:", (err as Error).message);
    return allowAll; // fail-open on a transient Redis error
  }
}

// Throttle identity for an unauthenticated request: the real client IP, or a single
// shared "unknown" bucket when a proxy strips it (so the limit still applies globally
// rather than silently disappearing).
export function ipIdentifier(req: Request): string {
  return clientIp(req) ?? "unknown";
}

// The standard 429 envelope (Section 7.1) plus a Retry-After header.
export function rateLimitedResponse(result: RateLimitResult): NextResponse {
  const res = fail(
    `Too many requests — slow down and try again in ${result.retryAfterSec}s`,
    429,
    "RATE_LIMITED",
    { retryAfterSec: result.retryAfterSec, limit: result.limit },
  );
  res.headers.set("Retry-After", String(result.retryAfterSec));
  return res;
}

// One-liner for route handlers: returns a ready-to-return 429 response when the caller
// is over the limit, or null when the request may proceed.
//
//   const limited = await enforceRateLimit(RATE_LIMITS.login, ipIdentifier(req));
//   if (limited) return limited;
export async function enforceRateLimit(rule: RateLimitRule, identifier: string): Promise<NextResponse | null> {
  const result = await rateLimit(rule, identifier);
  return result.allowed ? null : rateLimitedResponse(result);
}
