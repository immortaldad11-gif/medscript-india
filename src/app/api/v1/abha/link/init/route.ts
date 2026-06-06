import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/http";
import { AuthError, requireAuth } from "@/lib/auth";
import { abhaInitSchema } from "@/lib/validation";
import { validateAbhaIdentifier, initAbhaOtp, signAbhaTxn } from "@/lib/abdm";
import { audit, clientIp } from "@/lib/audit";

// POST /api/v1/abha/link/init — Step 1 of ABHA linking (Section 2.2).
// Validates the ABHA number/address and "sends" an OTP to the linked mobile via the
// ABDM Gateway. Returns a signed, time-limited transaction id for the verify step.
export async function POST(req: NextRequest) {
  let session;
  try {
    session = requireAuth(req, ["PATIENT"]);
  } catch (err) {
    if (err instanceof AuthError) return fail(err.message, err.status, err.code);
    throw err;
  }

  const body = await req.json().catch(() => null);
  const parsed = abhaInitSchema.safeParse(body);
  if (!parsed.success) return fail("Validation failed", 422, "VALIDATION_ERROR", parsed.error.flatten());

  const v = validateAbhaIdentifier(parsed.data);
  if (!v.ok) return fail(v.reason ?? "Invalid ABHA identifier", 422, "INVALID_ABHA");

  const challenge = initAbhaOtp(v);
  const txnId = signAbhaTxn(session.sub, v, challenge.expiresInSec);

  await audit({
    entityType: "user",
    entityId: session.sub,
    action: "ABHA_OTP_REQUESTED",
    performedById: session.sub,
    ipAddress: clientIp(req),
    metadata: { via: v.abhaNumber ? "number" : "address" },
  });

  return ok({
    txnId,
    maskedMobile: challenge.maskedMobile,
    expiresInSec: challenge.expiresInSec,
    // Dev convenience only — never returned in production.
    devOtp: process.env.NODE_ENV !== "production" ? process.env.ABHA_DEV_OTP || "123456" : undefined,
  });
}
