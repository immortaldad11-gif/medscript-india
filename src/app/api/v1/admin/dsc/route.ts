import type { NextRequest } from "next/server";
import { ok, fail, failWithIncident } from "@/lib/http";
import { AuthError, requireAuth } from "@/lib/auth";
import { listDscCertificates, isEnvManagedDsc } from "@/lib/dsc";

// GET /api/v1/admin/dsc — Section 5.1. Platform signing-key inventory for SUPER_ADMIN.
// Lists the active DSC plus every retired certificate still used to verify older
// prescriptions. envManaged=true means the key is sourced from env/HSM PEMs and rotation
// is owned by the Certifying Authority (the rotate endpoint is a no-op in that mode).
export async function GET(req: NextRequest) {
  try {
    requireAuth(req, ["SUPER_ADMIN"]);
    const certificates = listDscCertificates();
    const active = certificates.find((c) => c.active) ?? null;
    return ok({
      envManaged: isEnvManagedDsc(),
      activeSerial: active?.serial ?? null,
      count: certificates.length,
      // Public-key material only — no private keys ever leave the signing module.
      certificates: certificates.map((c) => ({
        serial: c.serial,
        subject: c.subject,
        issuer: c.issuer,
        algorithm: c.algorithm,
        validFrom: c.validFrom,
        validTo: c.validTo,
        active: c.active,
      })),
    });
  } catch (err) {
    if (err instanceof AuthError) return fail(err.message, err.status, err.code);
    return failWithIncident({ req, source: "api:admin:dsc:list", message: "Failed to load signing keys", error: err });
  }
}
