import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, fail } from "@/lib/http";
import { getSession } from "@/lib/auth";
import { generateSecret, otpauthQrDataUrl } from "@/lib/twofa";
import { encryptField } from "@/lib/crypto";

// POST /api/v1/auth/2fa/setup — generate a new TOTP secret and return a QR to scan.
// Secret is stored encrypted but not yet enabled until confirmed via /2fa/enable.
export async function POST(req: NextRequest) {
  const session = getSession(req);
  if (!session) return fail("Authentication required", 401, "UNAUTHORIZED");

  const user = await prisma.user.findUnique({ where: { id: session.sub } });
  if (!user) return fail("User not found", 404, "NOT_FOUND");

  const secret = generateSecret();
  await prisma.user.update({ where: { id: user.id }, data: { twoFactorSecret: encryptField(secret) } });

  const label = user.email ?? user.phone;
  const qr = await otpauthQrDataUrl(label, secret);
  return ok({ qr, secret });
}
