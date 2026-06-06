import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, fail, failWithIncident } from "@/lib/http";
import { AuthError, requireAuth } from "@/lib/auth";
import { decryptField } from "@/lib/crypto";
import { audit, clientIp } from "@/lib/audit";
import { maskAbhaNumber } from "@/lib/abdm";

// GET /api/v1/abha — current ABHA linkage status for the signed-in patient.
export async function GET(req: NextRequest) {
  try {
    const session = requireAuth(req, ["PATIENT"]);
    const user = await prisma.user.findUnique({ where: { id: session.sub } });
    if (!user) return fail("User not found", 404, "NOT_FOUND");

    const linked = !!user.abhaAddress && !!user.abhaLinkedAt;
    let maskedNumber: string | null = null;
    if (linked && user.abhaId) {
      try {
        maskedNumber = maskAbhaNumber(decryptField(user.abhaId));
      } catch {
        maskedNumber = "••••";
      }
    }
    return ok({
      linked,
      abhaAddress: user.abhaAddress,
      maskedNumber,
      linkedAt: user.abhaLinkedAt,
      kycStatus: user.kycStatus,
    });
  } catch (err) {
    if (err instanceof AuthError) return fail(err.message, err.status, err.code);
    return failWithIncident({ req, source: "api:abha:get", message: "Failed to load ABHA status", error: err });
  }
}

// DELETE /api/v1/abha — unlink the ABHA from this account.
export async function DELETE(req: NextRequest) {
  try {
    const session = requireAuth(req, ["PATIENT"]);
    await prisma.user.update({
      where: { id: session.sub },
      data: { abhaId: null, abhaAddress: null, abhaLinkedAt: null },
    });
    await audit({
      entityType: "user",
      entityId: session.sub,
      action: "ABHA_UNLINKED",
      performedById: session.sub,
      ipAddress: clientIp(req),
    });
    return ok({ linked: false });
  } catch (err) {
    if (err instanceof AuthError) return fail(err.message, err.status, err.code);
    return failWithIncident({ req, source: "api:abha:unlink", message: "Failed to unlink ABHA", error: err });
  }
}
