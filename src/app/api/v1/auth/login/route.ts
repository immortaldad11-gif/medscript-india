import type { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { ok, fail } from "@/lib/http";
import { loginSchema } from "@/lib/validation";
import { startSession } from "@/lib/session";
import { decryptField } from "@/lib/crypto";
import { verifyToken } from "@/lib/twofa";
import { audit, clientIp } from "@/lib/audit";
import { enforceRateLimit, ipIdentifier, RATE_LIMITS } from "@/lib/rate-limit";
import { ROLES_REQUIRING_2FA } from "@/lib/auth";

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

// POST /api/v1/auth/login — password + optional TOTP. Account lockout after 5 fails.
export async function POST(req: NextRequest) {
  // Per-IP throttle (Section 3.2) — coarse credential-stuffing / DoS guard that
  // complements the per-account lockout below. Runs before any bcrypt work.
  const limited = await enforceRateLimit(RATE_LIMITS.login, ipIdentifier(req));
  if (limited) return limited;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON body", 400, "INVALID_BODY");
  }

  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) return fail("Validation failed", 422, "VALIDATION_ERROR", parsed.error.flatten());
  const { identifier, password, totp } = parsed.data;

  const user = await prisma.user.findFirst({
    where: { OR: [{ phone: identifier }, { email: identifier }] },
  });

  // Generic message to avoid user enumeration.
  if (!user) {
    await bcrypt.compare(password, "$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv");
    return fail("Invalid credentials", 401, "INVALID_CREDENTIALS");
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    return fail(`Account locked. Try again after ${user.lockedUntil.toLocaleTimeString("en-IN")}`, 423, "ACCOUNT_LOCKED");
  }
  if (!user.isActive) return fail("Account is deactivated", 403, "INACTIVE");

  const passwordOk = await bcrypt.compare(password, user.passwordHash);
  if (!passwordOk) {
    const attempts = user.failedLoginAttempts + 1;
    const lock = attempts >= MAX_ATTEMPTS;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: lock ? 0 : attempts,
        lockedUntil: lock ? new Date(Date.now() + LOCK_MINUTES * 60 * 1000) : null,
      },
    });
    await audit({ entityType: "user", entityId: user.id, action: "LOGIN_FAILED", performedById: user.id, ipAddress: clientIp(req), metadata: { attempts } });
    return fail(lock ? "Too many attempts — account locked for 15 minutes" : "Invalid credentials", lock ? 423 : 401, lock ? "ACCOUNT_LOCKED" : "INVALID_CREDENTIALS");
  }

  // Password correct. Handle 2FA.
  if (user.twoFactorEnabled) {
    if (!totp) {
      return ok({ twoFactorRequired: true }, 200);
    }
    const secret = user.twoFactorSecret ? decryptField(user.twoFactorSecret) : null;
    if (!secret || !verifyToken(totp, secret)) {
      await audit({ entityType: "user", entityId: user.id, action: "2FA_FAILED", performedById: user.id, ipAddress: clientIp(req) });
      return fail("Invalid 2FA code", 401, "INVALID_2FA");
    }
  }

  await prisma.user.update({ where: { id: user.id }, data: { failedLoginAttempts: 0, lockedUntil: null } });
  await startSession(user, user.twoFactorEnabled);
  await audit({ entityType: "user", entityId: user.id, action: "LOGIN_SUCCESS", performedById: user.id, ipAddress: clientIp(req) });

  const twoFactorSetupRequired = !user.twoFactorEnabled && ROLES_REQUIRING_2FA.includes(user.role);
  return ok({ id: user.id, role: user.role, twoFactorSetupRequired });
}
