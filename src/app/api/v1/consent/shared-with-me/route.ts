import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, fail, failWithIncident } from "@/lib/http";
import { AuthError, requireAuth } from "@/lib/auth";

// GET /api/v1/consent/shared-with-me — the grantee (doctor) view of records shared
// with them that are still ACTIVE and unexpired.
export async function GET(req: NextRequest) {
  try {
    const session = requireAuth(req, ["DOCTOR", "LAB_TECHNICIAN", "RADIOLOGIST"]);
    const rows = await prisma.consentArtefact.findMany({
      where: { granteeId: session.sub, status: "ACTIVE", expiresAt: { gt: new Date() } },
      orderBy: { grantedAt: "desc" },
      take: 100,
    });

    const patientIds = [...new Set(rows.map((r) => r.patientId))];
    const patients = await prisma.user.findMany({
      where: { id: { in: patientIds } },
      select: { id: true, phone: true, patient: { select: { fullName: true } } },
    });
    const byId = new Map(patients.map((p) => [p.id, p]));

    const data = rows.map((r) => {
      const p = byId.get(r.patientId);
      return {
        id: r.id,
        patientName: p?.patient?.fullName ?? "Patient",
        patientPhone: p?.phone ?? null,
        purpose: r.purpose,
        dataTypes: r.dataTypes,
        reportCount: Array.isArray(r.reportIds) ? (r.reportIds as unknown[]).length : 0,
        grantedAt: r.grantedAt,
        expiresAt: r.expiresAt,
      };
    });
    return ok(data);
  } catch (err) {
    if (err instanceof AuthError) return fail(err.message, err.status, err.code);
    return failWithIncident({ req, source: "api:consent:shared-with-me", message: "Failed to load shared records", error: err });
  }
}
