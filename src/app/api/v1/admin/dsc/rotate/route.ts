import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/http";
import { AuthError, requireAuth } from "@/lib/auth";
import { rotateDsc } from "@/lib/dsc";
import { audit, clientIp } from "@/lib/audit";

// POST /api/v1/admin/dsc/rotate — Section 5.1. Rotate the platform DSC signing key.
// A new RSA-2048 key becomes active; the previous key is retained in the keyring so
// prescriptions signed under it keep verifying. SUPER_ADMIN only, audited. No-op when
// the key is env/HSM-managed (rotation is then owned by the Certifying Authority).
export async function POST(req: NextRequest) {
  let session;
  try {
    session = requireAuth(req, ["SUPER_ADMIN"]);
  } catch (err) {
    if (err instanceof AuthError) return fail(err.message, err.status, err.code);
    throw err;
  }

  const result = rotateDsc();
  if (!result.rotated) {
    return fail(result.reason ?? "Rotation not permitted", 409, "DSC_ROTATION_DISABLED");
  }

  await audit({
    entityType: "dsc",
    entityId: result.certificate?.serial,
    action: "DSC_ROTATED",
    performedById: session.sub,
    ipAddress: clientIp(req),
    metadata: { previousSerial: result.previousSerial, newSerial: result.certificate?.serial },
  });

  return ok({
    rotated: true,
    previousSerial: result.previousSerial,
    certificate: result.certificate
      ? {
          serial: result.certificate.serial,
          subject: result.certificate.subject,
          issuer: result.certificate.issuer,
          algorithm: result.certificate.algorithm,
          validFrom: result.certificate.validFrom,
          validTo: result.certificate.validTo,
          active: result.certificate.active,
        }
      : null,
  });
}
