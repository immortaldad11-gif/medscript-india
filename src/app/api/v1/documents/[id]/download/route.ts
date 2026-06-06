import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { fail, failWithIncident } from "@/lib/http";
import { getSession } from "@/lib/auth";
import { getObject, verifyDownloadSignature } from "@/lib/storage";
import { resolveActiveConsent, reportIdsOf } from "@/lib/consent";
import { audit, clientIp } from "@/lib/audit";

// GET /api/v1/documents/:id/download — stream the decrypted file.
// Three ways to be authorized (Section 4.3):
//   1. A valid time-scoped signed URL (?exp&sig) — the presigned-URL capability.
//   2. The owning patient (or SUPER_ADMIN) via session.
//   3. A grantee holding an ACTIVE consent that covers this report (?consent=<id>).
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const reportId = params.id;
  const report = await prisma.medicalReport.findUnique({ where: { id: reportId } });
  if (!report || !report.s3Key) return fail("Document not found", 404, "NOT_FOUND");

  const url = new URL(req.url);
  const exp = url.searchParams.get("exp");
  const sig = url.searchParams.get("sig");
  const consentId = url.searchParams.get("consent");

  let authorized = false;
  let viewerId: string | null = null;

  // (1) Signed URL capability — stateless, time-limited.
  if (verifyDownloadSignature(reportId, exp, sig)) {
    authorized = true;
  }

  const session = !authorized ? getSession(req) : null;

  // (2) Owner or admin.
  if (!authorized && session) {
    viewerId = session.sub;
    if (session.role === "SUPER_ADMIN" || report.patientId === session.sub) {
      authorized = true;
    }
  }

  // (3) Grantee with an active consent covering this report.
  if (!authorized && session && consentId) {
    const consent = await resolveActiveConsent(consentId, session.sub);
    if (consent && reportIdsOf(consent).includes(reportId)) {
      authorized = true;
      await audit({
        entityType: "medical_report",
        entityId: reportId,
        action: "DOCUMENT_ACCESSED",
        performedById: session.sub,
        ipAddress: clientIp(req),
        metadata: { consentId },
      });
    }
  }

  if (!authorized) return fail("Not authorized to access this document", 403, "FORBIDDEN");

  let bytes: Buffer;
  try {
    bytes = await getObject(report.s3Key);
  } catch (err) {
    return failWithIncident({ req, source: "api:documents:download", message: "Failed to read document", error: err, metadata: { reportId: report.id } });
  }

  const filename = report.originalFilename || `${report.title || "document"}`;
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": report.mimeType || "application/octet-stream",
      "Content-Disposition": `inline; filename="${filename.replace(/"/g, "")}"`,
      "Content-Length": String(bytes.length),
      "Cache-Control": "private, no-store",
    },
  });
}
