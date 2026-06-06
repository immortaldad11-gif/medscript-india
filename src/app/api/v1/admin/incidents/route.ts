import type { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ok, fail, failWithIncident } from "@/lib/http";
import { AuthError, requireAuth } from "@/lib/auth";

// GET /api/v1/admin/incidents — Section 5.1 observability.
// SUPER_ADMIN view of server-side failures recorded by reportIncident()/failWithIncident().
// Filters: ?status=open|resolved|all (default open), ?severity=WARNING|ERROR|CRITICAL,
// ?q=<request_id or text> (exact request_id match OR case-insensitive message/source contains).
// Returns the latest matches plus open counts per severity for the dashboard badges.
export async function GET(req: NextRequest) {
  try {
    requireAuth(req, ["SUPER_ADMIN"]);
    const url = new URL(req.url);
    const status = (url.searchParams.get("status") ?? "open").toLowerCase();
    const severity = url.searchParams.get("severity")?.toUpperCase();
    const q = url.searchParams.get("q")?.trim();
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 100, 1), 500);

    const where: Prisma.IncidentWhereInput = {};
    if (status === "open") where.resolved = false;
    else if (status === "resolved") where.resolved = true;
    if (severity === "WARNING" || severity === "ERROR" || severity === "CRITICAL") where.severity = severity;
    if (q) {
      where.OR = [
        { requestId: q },
        { message: { contains: q, mode: "insensitive" } },
        { source: { contains: q, mode: "insensitive" } },
      ];
    }

    const [incidents, openTotal, openBySeverity] = await Promise.all([
      prisma.incident.findMany({ where, orderBy: { createdAt: "desc" }, take: limit }),
      prisma.incident.count({ where: { resolved: false } }),
      prisma.incident.groupBy({ by: ["severity"], where: { resolved: false }, _count: true }),
    ]);

    return ok({
      incidents,
      openTotal,
      openBySeverity: Object.fromEntries(openBySeverity.map((g) => [g.severity, g._count])),
    });
  } catch (err) {
    if (err instanceof AuthError) return fail(err.message, err.status, err.code);
    return failWithIncident({ req, source: "api:admin:incidents:list", message: "Failed to load incidents", error: err });
  }
}
