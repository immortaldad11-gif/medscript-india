import test from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { signAccessToken, verifyAccessToken, getAccessSecret } from "@/lib/jwt";

// Security regression guards for the auth-secret hardening:
//   #1 — secrets must fail fast in production instead of falling back to a public default
//   #6 — JWT verification pins the algorithm (no alg-confusion / "none")
// Pure (no DB/Redis); secrets are read lazily per call so env can be toggled in-test.

const payload = { sub: "u1", role: "DOCTOR" as const, twoFactor: true };

test("sign/verify round-trips in development", () => {
  const decoded = verifyAccessToken(signAccessToken(payload));
  assert.equal(decoded.sub, "u1");
  assert.equal(decoded.role, "DOCTOR");
  assert.equal(decoded.twoFactor, true);
});

test("#6 a token signed under a non-HS256 algorithm is rejected", () => {
  const forged = jwt.sign(payload, getAccessSecret(), { algorithm: "HS512" });
  assert.throws(() => verifyAccessToken(forged), /invalid algorithm/i);
});

test("#1 FAIL-FAST: signing throws in production with a missing or default secret", () => {
  // NODE_ENV is typed read-only in @types/node; write through an untyped alias.
  const env = process.env as Record<string, string | undefined>;
  const origNodeEnv = env.NODE_ENV;
  const origSecret = env.JWT_ACCESS_SECRET;
  try {
    env.NODE_ENV = "production";

    // (a) still set to the publicly-known development default → must refuse
    env.JWT_ACCESS_SECRET = "dev-access-secret-change-me";
    assert.throws(() => signAccessToken(payload), /must be set to a strong, non-default value/);

    // (b) unset entirely → must refuse
    delete env.JWT_ACCESS_SECRET;
    assert.throws(() => signAccessToken(payload), /must be set/);

    // (c) a real secret → works
    env.JWT_ACCESS_SECRET = "a-strong-production-secret-value";
    assert.doesNotThrow(() => signAccessToken(payload));
  } finally {
    env.NODE_ENV = origNodeEnv;
    if (origSecret === undefined) delete env.JWT_ACCESS_SECRET;
    else env.JWT_ACCESS_SECRET = origSecret;
  }
});
