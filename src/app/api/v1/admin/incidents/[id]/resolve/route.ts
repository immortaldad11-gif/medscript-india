import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, fail, failWithIncident } from "@/lib/http";
import { AuthError, requireAuth } from "@/lib/auth";
import { audit, clientIp } from "@/lib/audit";

// POST /api/v1/admin/incidents/:id/resolve — SUPER_ADMIN marks an incident resolved (or
// reopens it with { resolved: false }). The triage action itself is audited so the audit
// log and the incident view stay mutually consistent.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  let session;
  try {
    session = requireAuth(req, ["SUPER_ADMIN"]);
  } catch (err) {
    if (err instanceof AuthError) return fail(err.message, err.status, err.code);
    throw err;
  }

  try {
    const body = await req.json().catch(() => ({}));
    const resolved = body?.resolved === false ? false : true;

    const existing = await prisma.incident.findUnique({ where: { id: params.id } });
    if (!existing) return fail("Incident not found", 404, "NOT_FOUND");

    const updated = await prisma.incident.update({
      where: { id: params.id },
      data: {
        resolved,
        resolvedAt: resolved ? new Date() : null,
        resolvedById: resolved ? session.sub : null,
      },
    });

    await audit({
      entityType: "incident",
      entityId: updated.id,
      action: resolved ? "INCIDENT_RESOLVED" : "INCIDENT_REOPENED",
      performedById: session.sub,
      ipAddress: clientIp(req),
      metadata: { requestId: updated.requestId, severity: updated.severity, source: updated.source },
    });

    return ok(updated);
  } catch (err) {
    return failWithIncident({ req, source: "api:admin:incidents:resolve", message: "Failed to update incident", error: err, userId: session.sub, metadata: { id: params.id } });
  }
}
