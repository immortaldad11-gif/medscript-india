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

// POST /api/v1/auth/2fa/enable — confirm the TOTP code and enable 2FA.
export async function POST(req: NextRequest) {
  const session = getSession(req);
  if (!session) return fail("Authentication required", 401, "UNAUTHORIZED");

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return fail("Validation failed", 422, "VALIDATION_ERROR", parsed.error.flatten());

  const user = await prisma.user.findUnique({ where: { id: session.sub } });
  if (!user?.twoFactorSecret) return fail("Start 2FA setup first", 400, "NO_SECRET");

  const secret = decryptField(user.twoFactorSecret);
  if (!verifyToken(parsed.data.totp, secret)) return fail("Invalid 2FA code", 401, "INVALID_2FA");

  await prisma.user.update({ where: { id: user.id }, data: { twoFactorEnabled: true } });
  // Re-issue the session so the access token reflects twoFactor: true.
  await startSession(user, true);
  await audit({ entityType: "user", entityId: user.id, action: "2FA_ENABLED", performedById: user.id, ipAddress: clientIp(req) });

  return ok({ twoFactorEnabled: true });
}
