import jwt, { type SignOptions, type Algorithm } from "jsonwebtoken";
import crypto from "crypto";
import type { Role } from "@prisma/client";

export interface AccessTokenPayload {
  sub: string; // user id
  role: Role;
  twoFactor: boolean; // whether 2FA was satisfied for this session
}

const ALG: Algorithm = "HS256";
const DEV_ACCESS_DEFAULT = "dev-access-secret-change-me";
const DEV_REFRESH_DEFAULT = "dev-refresh-secret-change-me";

// Read a JWT signing secret. Fails fast in production rather than silently falling back
// to a publicly-known development default — otherwise a forgotten env var would let
// anyone forge tokens (including SUPER_ADMIN). Mirrors crypto.ts's fail-fast on the
// field-encryption key. Lazy (per call) so a production *build* without runtime secrets
// doesn't throw — only actual signing/verifying does. Treating the dev default as
// "unset" also blocks shipping a .env that still contains the example value.
function jwtSecret(name: "JWT_ACCESS_SECRET" | "JWT_REFRESH_SECRET", devDefault: string): string {
  const v = process.env[name];
  if (v && v !== devDefault) return v;
  if (process.env.NODE_ENV === "production") {
    throw new Error(`${name} must be set to a strong, non-default value in production`);
  }
  return devDefault;
}

// Exported so document-download URL signing (storage.ts) shares the same fail-fast secret.
export const getAccessSecret = (): string => jwtSecret("JWT_ACCESS_SECRET", DEV_ACCESS_DEFAULT);
const getRefreshSecret = (): string => jwtSecret("JWT_REFRESH_SECRET", DEV_REFRESH_DEFAULT);

const ACCESS_TTL = (process.env.JWT_ACCESS_TTL ?? "15m") as SignOptions["expiresIn"];
const REFRESH_TTL = (process.env.JWT_REFRESH_TTL ?? "7d") as SignOptions["expiresIn"];

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, getAccessSecret(), { expiresIn: ACCESS_TTL, algorithm: ALG });
}

export function signRefreshToken(userId: string): string {
  // jti makes every token (and thus its stored hash) unique, even for two logins
  // within the same second — otherwise identical payload+iat collides on tokenHash.
  return jwt.sign({ sub: userId, jti: crypto.randomUUID() }, getRefreshSecret(), { expiresIn: REFRESH_TTL, algorithm: ALG });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  // Pin the algorithm so a token can never be accepted under an unexpected alg.
  return jwt.verify(token, getAccessSecret(), { algorithms: [ALG] }) as AccessTokenPayload;
}

export function verifyRefreshToken(token: string): { sub: string } {
  return jwt.verify(token, getRefreshSecret(), { algorithms: [ALG] }) as { sub: string };
}
