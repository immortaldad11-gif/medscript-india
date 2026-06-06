import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import type { Role } from "@prisma/client";
import { verifyAccessToken, type AccessTokenPayload } from "@/lib/jwt";

export const ACCESS_COOKIE = "ms_access";
export const REFRESH_COOKIE = "ms_refresh";

export class AuthError extends Error {
  constructor(
    message: string,
    public status = 401,
    public code = "UNAUTHORIZED",
  ) {
    super(message);
  }
}

function extractToken(req?: NextRequest): string | null {
  // Prefer Authorization header (mobile/API clients), fall back to cookie (web).
  if (req) {
    const header = req.headers.get("authorization");
    if (header?.startsWith("Bearer ")) return header.slice(7);
  }
  const cookie = cookies().get(ACCESS_COOKIE)?.value;
  return cookie ?? null;
}

export function getSession(req?: NextRequest): AccessTokenPayload | null {
  const token = extractToken(req);
  if (!token) return null;
  try {
    return verifyAccessToken(token);
  } catch {
    return null;
  }
}

// Require an authenticated session, optionally constrained to specific roles.
// 2FA-enabled accounts must have completed the 2FA step for the session.
export function requireAuth(req?: NextRequest, roles?: Role[]): AccessTokenPayload {
  const session = getSession(req);
  if (!session) throw new AuthError("Authentication required");
  if (roles && roles.length > 0 && !roles.includes(session.role)) {
    throw new AuthError("Insufficient permissions for this action", 403, "FORBIDDEN");
  }
  return session;
}
