import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, fail, failWithIncident } from "@/lib/http";
import { AuthError, requireAuth } from "@/lib/auth";

// GET /api/v1/patients/lookup?phone=+91... — staff/doctor patient search by phone
// (Section 4.1.1 "Patient Lookup"). Returns the patient if registered, else 404 so
// the caller can offer to create a placeholder account on upload.
export async function GET(req: NextRequest) {
  try {
    requireAuth(req, ["DOCTOR", "LAB_TECHNICIAN", "RADIOLOGIST", "SUPER_ADMIN"]);
    const phone = new URL(req.url).searchParams.get("phone")?.trim();
    if (!phone) return fail("phone is required", 422, "NO_PHONE");

    const user = await prisma.user.findUnique({
      where: { phone },
      select: { id: true, role: true, phone: true, patient: { select: { fullName: true } } },
    });
    if (!user || user.role !== "PATIENT") return fail("No patient with that number", 404, "NOT_FOUND");

    return ok({ id: user.id, phone: user.phone, fullName: user.patient?.fullName ?? null });
  } catch (err) {
    if (err instanceof AuthError) return fail(err.message, err.status, err.code);
    return failWithIncident({ req, source: "api:patients:lookup", message: "Lookup failed", error: err });
  }
}
