import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, fail } from "@/lib/http";
import { getSession } from "@/lib/auth";

// GET /api/v1/auth/me — current user profile.
export async function GET(req: NextRequest) {
  const session = getSession(req);
  if (!session) return fail("Authentication required", 401, "UNAUTHORIZED");

  const user = await prisma.user.findUnique({
    where: { id: session.sub },
    include: { doctor: true, patient: true },
  });
  if (!user) return fail("User not found", 404, "NOT_FOUND");

  return ok({
    id: user.id,
    role: user.role,
    phone: user.phone,
    email: user.email,
    kycStatus: user.kycStatus,
    twoFactorEnabled: user.twoFactorEnabled,
    twoFactorSatisfied: session.twoFactor,
    doctor: user.doctor
      ? {
          specialisation: user.doctor.specialisation,
          qualification: user.doctor.qualification,
          clinicName: user.doctor.clinicName,
          mciRegNo: user.mciRegNo,
        }
      : null,
    patient: user.patient ? { fullName: user.patient.fullName, bloodGroup: user.patient.bloodGroup } : null,
  });
}
