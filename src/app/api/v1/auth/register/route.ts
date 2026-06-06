import type { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { ok, fail, failWithIncident } from "@/lib/http";
import { registerSchema } from "@/lib/validation";
import { verifyMciRegistration } from "@/lib/mci";
import { encryptField } from "@/lib/crypto";
import { audit, clientIp } from "@/lib/audit";
import { Prisma, KycStatus } from "@prisma/client";

// POST /api/v1/auth/register — doctor (with MCI verification) or patient registration.
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON body", 400, "INVALID_BODY");
  }

  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return fail("Validation failed", 422, "VALIDATION_ERROR", parsed.error.flatten());
  }
  const input = parsed.data;
  const passwordHash = await bcrypt.hash(input.password, 12);

  try {
    if (input.role === "DOCTOR") {
      const mci = await verifyMciRegistration(input.mciRegNo, input.fullName);
      if (!mci.verified) {
        return fail(`MCI/NMC verification failed: ${mci.reason}`, 422, "MCI_VERIFICATION_FAILED");
      }
      const user = await prisma.user.create({
        data: {
          role: "DOCTOR",
          phone: input.phone,
          email: input.email,
          passwordHash,
          mciRegNo: input.mciRegNo,
          kycStatus: KycStatus.VERIFIED, // verified via MCI check
          doctor: {
            create: {
              fullName: input.fullName,
              specialisation: input.specialisation,
              qualification: input.qualification,
              clinicName: input.clinicName,
              clinicAddress: input.clinicAddress,
              gstin: input.gstin,
            },
          },
        },
      });
      await audit({ entityType: "user", entityId: user.id, action: "REGISTER_DOCTOR", performedById: user.id, ipAddress: clientIp(req) });
      return ok({ id: user.id, role: user.role, twoFactorRequired: true }, 201);
    }

    // PATIENT
    const user = await prisma.user.create({
      data: {
        role: "PATIENT",
        phone: input.phone,
        email: input.email,
        passwordHash,
        abhaId: input.abhaId ? encryptField(input.abhaId) : undefined,
        kycStatus: KycStatus.PENDING,
        patient: {
          create: {
            fullName: input.fullName,
            gender: input.gender,
            dob: input.dob ? new Date(input.dob) : undefined,
            bloodGroup: input.bloodGroup,
          },
        },
      },
    });
    await audit({ entityType: "user", entityId: user.id, action: "REGISTER_PATIENT", performedById: user.id, ipAddress: clientIp(req) });
    return ok({ id: user.id, role: user.role, twoFactorRequired: false }, 201);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const target = (err.meta?.target as string[] | undefined)?.join(", ") ?? "field";
      return fail(`An account with this ${target} already exists`, 409, "DUPLICATE");
    }
    return failWithIncident({ req, source: "api:auth:register", message: "Registration failed", error: err });
  }
}
