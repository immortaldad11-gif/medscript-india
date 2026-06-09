import type { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ok, fail } from "@/lib/http";
import { getSession } from "@/lib/auth";
import { decryptField } from "@/lib/crypto";
import { verifyToken } from "@/lib/twofa";
import { startSession } from "@/lib/session";
import { audit, clientIp } from "@/lib/audit";

const schema = z.object({ totp: z.string().min(6).max(8) });

// POST /api/v1/auth/2fa/disable — turn off 2FA for the current account.
// Requires the CURRENT TOTP: a live access token alone is not enough to strip the
// second factor, so a stolen session can't disable 2FA. After this, the user may
// re-enrol via /2fa/setup. For a privileged role (which requires 2FA), the re-issued
// session is no longer 2FA-satisfied, so protected endpoints stay gated until re-enrol.
export async function POST(req: NextRequest) {
  const session = getSession(req);
  if (!session) return fail("Authentication required", 401, "UNAUTHORIZED");

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return fail("Validation failed", 422, "VALIDATION_ERROR", parsed.error.flatten());

  const user = await prisma.user.findUnique({ where: { id: session.sub } });
  if (!user) return fail("User not found", 404, "NOT_FOUND");
  if (!user.twoFactorEnabled || !user.twoFactorSecret) {
    return fail("Two-factor authentication is not enabled", 409, "2FA_NOT_ENABLED");
  }

  const secret = decryptField(user.twoFactorSecret);
  if (!verifyToken(parsed.data.totp, secret)) {
    await audit({ entityType: "user", entityId: user.id, action: "2FA_DISABLE_FAILED", performedById: user.id, ipAddress: clientIp(req) });
    return fail("Invalid 2FA code", 401, "INVALID_2FA");
  }

  await prisma.user.update({ where: { id: user.id }, data: { twoFactorEnabled: false, twoFactorSecret: null } });
  // Re-issue the session so its 2FA state reflects that 2FA is no longer satisfied.
  await startSession(user, false);
  await audit({ entityType: "user", entityId: user.id, action: "2FA_DISABLED", performedById: user.id, ipAddress: clientIp(req) });

  return ok({ twoFactorEnabled: false });
}
