import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, fail, failWithIncident } from "@/lib/http";
import { AuthError, requireAuth } from "@/lib/auth";

// GET /api/v1/prescriptions/:id — requires doctor ownership, patient ownership, or admin.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = requireAuth(req);
    const rx = await prisma.prescription.findUnique({
      where: { id: params.id },
      include: { medications: true, interactions: true },
    });
    if (!rx) return fail("Prescription not found", 404, "NOT_FOUND");

    const allowed =
      session.role === "SUPER_ADMIN" || rx.doctorId === session.sub || rx.patientId === session.sub;
    if (!allowed) return fail("You do not have access to this prescription", 403, "FORBIDDEN");

    return ok(rx);
  } catch (err) {
    if (err instanceof AuthError) return fail(err.message, err.status, err.code);
    return failWithIncident({ req, source: "api:prescriptions:get", message: "Failed to load prescription", error: err, metadata: { id: params.id } });
  }
}
