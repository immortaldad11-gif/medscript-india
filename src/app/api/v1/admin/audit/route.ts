import type { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ok, fail, failWithIncident } from "@/lib/http";
import { AuthError, requireAuth } from "@/lib/auth";

// GET /api/v1/admin/audit — Section 5.1 accountability (DPDPA 2023).
// SUPER_ADMIN read view over the immutable audit trail. Filters: ?action=, ?entityType=,
// ?q=<entityId or actor id>. Resolves the acting user (role + display name) for readability.
// The trail is append-only — there is no write/delete surface here, by design.
export async function GET(req: NextRequest) {
  try {
    requireAuth(req, ["SUPER_ADMIN"]);
    const url = new URL(req.url);
    const action = url.searchParams.get("action")?.trim();
    const entityType = url.searchParams.get("entityType")?.trim();
    const q = url.searchParams.get("q")?.trim();
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 100, 1), 500);

    const where: Prisma.AuditLogWhereInput = {};
    if (action) where.action = action;
    if (entityType) where.entityType = entityType;
    if (q) where.OR = [{ entityId: q }, { performedById: q }];

    const [logs, actions] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { timestamp: "desc" },
        take: limit,
        include: {
          performedBy: {
            select: {
              id: true,
              role: true,
              phone: true,
              doctor: { select: { fullName: true } },
              patient: { select: { fullName: true } },
            },
          },
        },
      }),
      // Distinct action names power the filter dropdown in the UI.
      prisma.auditLog.findMany({ distinct: ["action"], select: { action: true }, orderBy: { action: "asc" } }),
    ]);

    const shaped = logs.map((l) => ({
      id: l.id,
      action: l.action,
      entityType: l.entityType,
      entityId: l.entityId,
      timestamp: l.timestamp,
      ipAddress: l.ipAddress,
      metadata: l.metadata,
      actor: l.performedBy
        ? {
            id: l.performedBy.id,
            role: l.performedBy.role,
            name: l.performedBy.doctor?.fullName ?? l.performedBy.patient?.fullName ?? l.performedBy.phone,
          }
        : null,
    }));

    return ok({ logs: shaped, actions: actions.map((a) => a.action) });
  } catch (err) {
    if (err instanceof AuthError) return fail(err.message, err.status, err.code);
    return failWithIncident({ req, source: "api:admin:audit:list", message: "Failed to load audit log", error: err });
  }
}
