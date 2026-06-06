import { cookies } from "next/headers";
import type { Role, User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "@/lib/jwt";
import { sha256 } from "@/lib/crypto";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "@/lib/auth";

const SEVEN_DAYS = 7 * 24 * 60 * 60;
const FIFTEEN_MIN = 15 * 60;

function cookieOpts(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

// Issue an access+refresh pair, persist the refresh token hash, and set cookies.
export async function startSession(user: Pick<User, "id" | "role">, twoFactorSatisfied: boolean) {
  const access = signAccessToken({ sub: user.id, role: user.role as Role, twoFactor: twoFactorSatisfied });
  const refresh = signRefreshToken(user.id);

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: sha256(refresh),
      expiresAt: new Date(Date.now() + SEVEN_DAYS * 1000),
    },
  });

  const jar = cookies();
  jar.set(ACCESS_COOKIE, access, cookieOpts(FIFTEEN_MIN));
  jar.set(REFRESH_COOKIE, refresh, cookieOpts(SEVEN_DAYS));

  return { access, refresh };
}

// Rotate a refresh token: validate, revoke the old, issue a new pair.
export async function rotateSession(rawRefresh: string) {
  const payload = verifyRefreshToken(rawRefresh); // throws if invalid/expired
  const hash = sha256(rawRefresh);
  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash: hash } });
  if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
    throw new Error("Refresh token is no longer valid");
  }
  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user || !user.isActive) throw new Error("User not found or inactive");

  await prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });
  // 2FA was already satisfied to obtain the original refresh token.
  return startSession(user, user.twoFactorEnabled);
}

export async function endSession() {
  const jar = cookies();
  const raw = jar.get(REFRESH_COOKIE)?.value;
  if (raw) {
    await prisma.refreshToken.updateMany({ where: { tokenHash: sha256(raw) }, data: { revokedAt: new Date() } });
  }
  jar.delete(ACCESS_COOKIE);
  jar.delete(REFRESH_COOKIE);
}
