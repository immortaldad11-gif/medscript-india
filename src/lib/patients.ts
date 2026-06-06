import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { randomToken } from "@/lib/crypto";

// Resolve the patient User for a prescription. Doctors create prescriptions by
// looking up an existing patient (by id or phone). If the patient isn't on the
// platform yet, we create a minimal placeholder account they can later claim —
// mirrors the "Patient Lookup → auto-populate / new patient" flow (Section 4.1.1).
export async function resolvePatient(params: {
  patientId?: string;
  patientPhone?: string;
  patientName: string;
}) {
  if (params.patientId) {
    const u = await prisma.user.findUnique({ where: { id: params.patientId }, include: { patient: true } });
    if (!u || u.role !== "PATIENT") return null;
    return u;
  }

  if (params.patientPhone) {
    const existing = await prisma.user.findUnique({ where: { phone: params.patientPhone }, include: { patient: true } });
    if (existing) return existing.role === "PATIENT" ? existing : null;

    // Placeholder account with an unguessable random password (claimed later).
    const passwordHash = await bcrypt.hash(randomToken(16), 12);
    return prisma.user.create({
      data: {
        role: "PATIENT",
        phone: params.patientPhone,
        passwordHash,
        kycStatus: "PENDING",
        patient: { create: { fullName: params.patientName } },
      },
      include: { patient: true },
    });
  }

  return null;
}
