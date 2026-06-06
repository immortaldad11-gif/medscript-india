import jwt, { type SignOptions } from "jsonwebtoken";
import crypto from "crypto";
import type { Role } from "@prisma/client";

export interface AccessTokenPayload {
  sub: string; // user id
  role: Role;
  twoFactor: boolean; // whether 2FA was satisfied for this session
}

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? "dev-access-secret-change-me";
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? "dev-refresh-secret-change-me";
const ACCESS_TTL = (process.env.JWT_ACCESS_TTL ?? "15m") as SignOptions["expiresIn"];
const REFRESH_TTL = (process.env.JWT_REFRESH_TTL ?? "7d") as SignOptions["expiresIn"];

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, ACCESS_SECRET, { expiresIn: ACCESS_TTL });
}

export function signRefreshToken(userId: string): string {
  // jti makes every token (and thus its stored hash) unique, even for two logins
  // within the same second — otherwise identical payload+iat collides on tokenHash.
  return jwt.sign({ sub: userId, jti: crypto.randomUUID() }, REFRESH_SECRET, { expiresIn: REFRESH_TTL });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, ACCESS_SECRET) as AccessTokenPayload;
}

export function verifyRefreshToken(token: string): { sub: string } {
  return jwt.verify(token, REFRESH_SECRET) as { sub: string };
}
