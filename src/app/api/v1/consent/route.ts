import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, fail, failWithIncident } from "@/lib/http";
import { AuthError, requireAuth } from "@/lib/auth";
import { grantConsentSchema } from "@/lib/validation";
import { grantConsent } from "@/lib/consent";
import { audit, clientIp } from "@/lib/audit";
import { notifyWithFallback } from "@/lib/notifications";

// GET /api/v1/consent — the patient's own consents (the "who can see my data" view).
export async function GET(req: NextRequest) {
  try {
    const session = requireAuth(req);
    const rows = await prisma.consentArtefact.findMany({
      where: { patientId: session.sub },
      orderBy: { grantedAt: "desc" },
      take: 100,
    });

    // Decorate with grantee display name + report count for the UI.
    const granteeIds = [...new Set(rows.map((r) => r.granteeId))];
    const grantees = await prisma.user.findMany({
      where: { id: { in: granteeIds } },
      select: { id: true, mciRegNo: true, doctor: { select: { fullName: true, clinicName: true } } },
    });
    const byId = new Map(grantees.map((g) => [g.id, g]));

    const data = rows.map((r) => {
      const g = byId.get(r.granteeId);
      return {
        id: r.id,
        granteeName: g?.doctor?.fullName ?? "Unknown",
        granteeClinic: g?.doctor?.clinicName ?? null,
        granteeMciRegNo: g?.mciRegNo ?? null,
        purpose: r.purpose,
        dataTypes: r.dataTypes,
        reportCount: Array.isArray(r.reportIds) ? (r.reportIds as unknown[]).length : 0,
        status: r.status,
        grantedAt: r.grantedAt,
        expiresAt: r.expiresAt,
        revokedAt: r.revokedAt,
      };
    });
    return ok(data);
  } catch (err) {
    if (err instanceof AuthError) return fail(err.message, err.status, err.code);
    return failWithIncident({ req, source: "api:consent:list", message: "Failed to load consents", error: err });
  }
}

// POST /api/v1/consent — patient grants a doctor time-scoped access to specific reports.
export async function POST(req: NextRequest) {
  let session;
  try {
    session = requireAuth(req, ["PATIENT"]);
  } catch (err) {
    if (err instanceof AuthError) return fail(err.message, err.status, err.code);
    throw err;
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON body", 400, "INVALID_BODY");
  }

  const parsed = grantConsentSchema.safeParse(body);
  if (!parsed.success) {
    return fail("Validation failed", 422, "VALIDATION", parsed.error.flatten());
  }
  const input = parsed.data;

  if (!input.granteeId && !input.granteeMciRegNo) {
    return fail("Provide the doctor's id or MCI/NMC registration number", 422, "NO_GRANTEE");
  }

  // Resolve the grantee — must be an existing doctor.
  const grantee = await prisma.user.findFirst({
    where: input.granteeId
      ? { id: input.granteeId }
      : { mciRegNo: input.granteeMciRegNo },
    include: { doctor: true },
  });
  if (!grantee || grantee.role !== "DOCTOR") {
    return fail("Doctor not found", 422, "GRANTEE_NOT_FOUND");
  }

  // The reports must all belong to the requesting patient.
  const reports = await prisma.medicalReport.findMany({
    where: { id: { in: input.reportIds }, patientId: session.sub },
    select: { id: true, reportType: true },
  });
  if (reports.length !== input.reportIds.length) {
    return fail("One or more documents do not exist or are not yours", 422, "INVALID_REPORTS");
  }

  const dataTypes = [...new Set(reports.map((r) => r.reportType))];

  const consent = await grantConsent({
    patientId: session.sub,
    granteeId: grantee.id,
    granteeType: "DOCTOR",
    purpose: input.purpose,
    reportIds: reports.map((r) => r.id),
    dataTypes,
    ttlSeconds: input.ttlSeconds,
  });

  await audit({
    entityType: "consent_artefact",
    entityId: consent.id,
    action: "CONSENT_GRANTED",
    performedById: session.sub,
    ipAddress: clientIp(req),
    metadata: { granteeId: grantee.id, reportCount: reports.length, ttlSeconds: input.ttlSeconds },
  });

  // Notify the doctor that records were shared (best-effort).
  if (grantee.phone) {
    const base = process.env.NEXT_PUBLIC_BASE_URL ?? "";
    await notifyWithFallback(
      grantee.phone,
      `A patient has shared ${reports.length} medical record(s) with you on MedScript. View: ${base}/shared`,
    ).catch(() => undefined);
  }

  return ok(
    {
      id: consent.id,
      granteeId: consent.granteeId,
      purpose: consent.purpose,
      reportIds: consent.reportIds,
      dataTypes: consent.dataTypes,
      expiresAt: consent.expiresAt,
      status: consent.status,
    },
    201,
  );
}
