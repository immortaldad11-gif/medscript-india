import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/http";
import { AuthError, requireAuth } from "@/lib/auth";
import { revokeConsent } from "@/lib/consent";
import { audit, clientIp } from "@/lib/audit";

// DELETE /api/v1/consent/:id — patient revokes a consent (Section 4.3.3, O(1) revoke).
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  let session;
  try {
    session = requireAuth(req, ["PATIENT"]);
  } catch (err) {
    if (err instanceof AuthError) return fail(err.message, err.status, err.code);
    throw err;
  }

  const revoked = await revokeConsent(params.id, session.sub);
  if (!revoked) return fail("Consent not found", 404, "NOT_FOUND");

  await audit({
    entityType: "consent_artefact",
    entityId: params.id,
    action: "CONSENT_REVOKED",
    performedById: session.sub,
    ipAddress: clientIp(req),
  });

  return ok({ id: params.id, status: "REVOKED" });
}
