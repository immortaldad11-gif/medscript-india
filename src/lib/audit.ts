import { prisma } from "@/lib/prisma";

// Immutable application audit trail — Section 5.1 (audit_logs table).
export async function audit(params: {
  entityType: string;
  entityId?: string;
  action: string;
  performedById?: string;
  ipAddress?: string | null;
  metadata?: Record<string, unknown>;
}) {
  try {
    await prisma.auditLog.create({
      data: {
        entityType: params.entityType,
        entityId: params.entityId,
        action: params.action,
        performedById: params.performedById,
        ipAddress: params.ipAddress ?? undefined,
        metadata: params.metadata as object | undefined,
      },
    });
  } catch (err) {
    // Auditing must never break the primary flow; log and continue.
    console.error("[audit] failed to write log:", (err as Error).message);
  }
}

export function clientIp(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip");
}
