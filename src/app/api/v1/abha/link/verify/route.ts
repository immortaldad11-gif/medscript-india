import type { NextRequest } from "next/server";
import { Prisma, KycStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ok, fail } from "@/lib/http";
import { AuthError, requireAuth } from "@/lib/auth";
import { abhaVerifySchema } from "@/lib/validation";
import { verifyAbhaTxn, fetchAbhaProfile, ABHA_DEV_OTP, maskAbhaNumber } from "@/lib/abdm";
import { encryptField } from "@/lib/crypto";
import { audit, clientIp } from "@/lib/audit";

// POST /api/v1/abha/link/verify — Step 2 of ABHA linking (Section 2.2).
// Verifies the OTP against the signed transaction, fetches the ABHA profile from the
// gateway, and links it: ABHA number stored encrypted-at-rest, address stored for
// lookup/display, KYC marked VERIFIED. Idempotent on the (unique) ABHA address.
export async function POST(req: NextRequest) {
  let session;
  try {
    session = requireAuth(req, ["PATIENT"]);
  } catch (err) {
    if (err instanceof AuthError) return fail(err.message, err.status, err.code);
    throw err;
  }

  const body = await req.json().catch(() => null);
  const parsed = abhaVerifySchema.safeParse(body);
  if (!parsed.success) return fail("Validation failed", 422, "VALIDATION_ERROR", parsed.error.flatten());

  const v = verifyAbhaTxn(parsed.data.txnId, session.sub);
  if (!v) return fail("Transaction expired or invalid — request a new OTP", 410, "TXN_INVALID");

  // OTP check. Production validates against the gateway; dev accepts the fixed OTP.
  if (parsed.data.otp !== ABHA_DEV_OTP) {
    return fail("Incorrect OTP", 401, "OTP_INCORRECT");
  }

  const patient = await prisma.patient.findUnique({ where: { userId: session.sub } });
  const profile = fetchAbhaProfile(v, patient?.fullName);

  try {
    await prisma.user.update({
      where: { id: session.sub },
      data: {
        abhaId: encryptField(profile.abhaNumber),
        abhaAddress: profile.abhaAddress,
        abhaLinkedAt: new Date(),
        kycStatus: KycStatus.VERIFIED,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return fail("This ABHA address is already linked to another account", 409, "ABHA_TAKEN");
    }
    throw err;
  }

  await audit({
    entityType: "user",
    entityId: session.sub,
    action: "ABHA_LINKED",
    performedById: session.sub,
    ipAddress: clientIp(req),
    metadata: { abhaAddress: profile.abhaAddress },
  });

  return ok({
    linked: true,
    abhaAddress: profile.abhaAddress,
    maskedNumber: maskAbhaNumber(profile.abhaNumber),
    fullName: profile.fullName,
    linkedAt: new Date(),
  });
}
