import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, fail } from "@/lib/http";
import { AuthError, requireAuth } from "@/lib/auth";
import { resolveActiveConsent, reportIdsOf } from "@/lib/consent";
import { signDownloadUrl } from "@/lib/storage";
import { audit, clientIp } from "@/lib/audit";

// GET /api/v1/consent/:id/access — grantee exchanges an ACTIVE consent for a set of
// time-scoped signed URLs over the shared documents (Section 4.3 presigned pattern).
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  let session;
  try {
    session = requireAuth(req, ["DOCTOR", "LAB_TECHNICIAN", "RADIOLOGIST"]);
  } catch (err) {
    if (err instanceof AuthError) return fail(err.message, err.status, err.code);
    throw err;
  }

  const consent = await resolveActiveConsent(params.id, session.sub);
  if (!consent) return fail("No active consent for this grant", 403, "CONSENT_INACTIVE");

  const ids = reportIdsOf(consent);
  const reports = await prisma.medicalReport.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      title: true,
      reportType: true,
      originalFilename: true,
      mimeType: true,
      sizeBytes: true,
      structuredData: true,
      createdAt: true,
    },
  });

  await audit({
    entityType: "consent_artefact",
    entityId: consent.id,
    action: "CONSENT_ACCESSED",
    performedById: session.sub,
    ipAddress: clientIp(req),
    metadata: { reportCount: reports.length },
  });

  const documents = reports.map((r) => ({
    ...r,
    downloadUrl: signDownloadUrl(r.id),
  }));

  return ok({ consentId: consent.id, expiresAt: consent.expiresAt, documents });
}
