import type { NextRequest } from "next/server";
import { z } from "zod";
import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ok, fail, failWithIncident } from "@/lib/http";
import { AuthError, requireAuth } from "@/lib/auth";
import { audit, clientIp } from "@/lib/audit";

// POST /api/v1/admin/users/:id — SUPER_ADMIN account administration (Section 2.4).
// One endpoint, three discriminated actions so guard logic (self-lockout, last-admin,
// profile-bound roles) stays centralised:
//   { action: "setActive", active }        — suspend / reactivate
//   { action: "setKyc",    kyc }           — approve / reject / reset KYC
//   { action: "setRole",   role }          — change role
// Every action is audited. Suspending or changing a role revokes the user's refresh tokens
// so the change takes effect at the next token refresh; the still-valid access JWT lapses
// within its 15-minute TTL (stateless by design — we do not hit the DB on every request).

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("setActive"), active: z.boolean() }),
  z.object({ action: z.literal("setKyc"), kyc: z.enum(["PENDING", "VERIFIED", "REJECTED"]) }),
  z.object({ action: z.literal("setRole"), role: z.enum(["SUPER_ADMIN", "DOCTOR", "PATIENT", "LAB_TECHNICIAN", "RADIOLOGIST"]) }),
]);

async function revokeRefreshTokens(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
}

function shape(u: { id: string; role: Role; phone: string; email: string | null; mciRegNo: string | null; kycStatus: string; isActive: boolean; twoFactorEnabled: boolean; lockedUntil: Date | null; createdAt: Date; doctor: { fullName: string } | null; patient: { fullName: string } | null }) {
  return {
    id: u.id,
    role: u.role,
    name: u.doctor?.fullName ?? u.patient?.fullName ?? u.phone,
    phone: u.phone,
    email: u.email,
    mciRegNo: u.mciRegNo,
    kycStatus: u.kycStatus,
    isActive: u.isActive,
    twoFactorEnabled: u.twoFactorEnabled,
    locked: !!u.lockedUntil && u.lockedUntil > new Date(),
    createdAt: u.createdAt,
    hasDoctorProfile: !!u.doctor,
    hasPatientProfile: !!u.patient,
  };
}

const INCLUDE = { doctor: { select: { fullName: true } }, patient: { select: { fullName: true } } } as const;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  let session;
  try {
    session = requireAuth(req, ["SUPER_ADMIN"]);
  } catch (err) {
    if (err instanceof AuthError) return fail(err.message, err.status, err.code);
    throw err;
  }

  try {
    const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return fail("Validation failed", 422, "VALIDATION_ERROR", parsed.error.flatten());
    const body = parsed.data;

    const target = await prisma.user.findUnique({ where: { id: params.id }, include: INCLUDE });
    if (!target) return fail("User not found", 404, "NOT_FOUND");

    const isSelf = target.id === session.sub;
    const ip = clientIp(req);

    // --- setActive: suspend / reactivate -------------------------------------------------
    if (body.action === "setActive") {
      if (isSelf && !body.active) return fail("You cannot suspend your own account", 400, "SELF_ACTION_FORBIDDEN");
      if (!body.active && target.role === "SUPER_ADMIN") {
        const otherActiveAdmins = await prisma.user.count({
          where: { role: "SUPER_ADMIN", isActive: true, id: { not: target.id } },
        });
        if (otherActiveAdmins === 0) return fail("Cannot suspend the last active administrator", 409, "LAST_ADMIN");
      }
      if (target.isActive === body.active) {
        return ok({ user: shape(target), changed: false });
      }
      const updated = await prisma.user.update({
        where: { id: target.id },
        data: body.active
          ? { isActive: true, failedLoginAttempts: 0, lockedUntil: null }
          : { isActive: false },
        include: INCLUDE,
      });
      if (!body.active) await revokeRefreshTokens(target.id);
      await audit({
        entityType: "user",
        entityId: target.id,
        action: body.active ? "USER_REACTIVATED" : "USER_SUSPENDED",
        performedById: session.sub,
        ipAddress: ip,
        metadata: { role: target.role },
      });
      return ok({ user: shape(updated), changed: true });
    }

    // --- setKyc: approve / reject / reset ------------------------------------------------
    if (body.action === "setKyc") {
      if (target.kycStatus === body.kyc) return ok({ user: shape(target), changed: false });
      const updated = await prisma.user.update({
        where: { id: target.id },
        data: { kycStatus: body.kyc },
        include: INCLUDE,
      });
      const actionByKyc = { VERIFIED: "USER_KYC_VERIFIED", REJECTED: "USER_KYC_REJECTED", PENDING: "USER_KYC_RESET" } as const;
      await audit({
        entityType: "user",
        entityId: target.id,
        action: actionByKyc[body.kyc],
        performedById: session.sub,
        ipAddress: ip,
        metadata: { from: target.kycStatus, to: body.kyc, role: target.role },
      });
      return ok({ user: shape(updated), changed: true });
    }

    // --- setRole: change role ------------------------------------------------------------
    if (isSelf && body.role !== target.role) {
      return fail("You cannot change your own role", 400, "SELF_ACTION_FORBIDDEN");
    }
    if (body.role === target.role) return ok({ user: shape(target), changed: false });
    // A profile-bound role cannot be assigned to a user with no matching profile row,
    // or the app would render a doctor/patient with no name, clinic, etc.
    if (body.role === "DOCTOR" && !target.doctor) {
      return fail("User has no doctor profile; cannot assign the DOCTOR role", 409, "MISSING_PROFILE");
    }
    if (body.role === "PATIENT" && !target.patient) {
      return fail("User has no patient profile; cannot assign the PATIENT role", 409, "MISSING_PROFILE");
    }
    // Never demote the platform's last administrator.
    if (target.role === "SUPER_ADMIN" && body.role !== "SUPER_ADMIN") {
      const otherActiveAdmins = await prisma.user.count({
        where: { role: "SUPER_ADMIN", isActive: true, id: { not: target.id } },
      });
      if (otherActiveAdmins === 0) return fail("Cannot demote the last active administrator", 409, "LAST_ADMIN");
    }

    const updated = await prisma.user.update({
      where: { id: target.id },
      data: { role: body.role },
      include: INCLUDE,
    });
    await revokeRefreshTokens(target.id); // force re-auth so the new role takes effect
    await audit({
      entityType: "user",
      entityId: target.id,
      action: "USER_ROLE_CHANGED",
      performedById: session.sub,
      ipAddress: ip,
      metadata: { from: target.role, to: body.role },
    });
    return ok({ user: shape(updated), changed: true });
  } catch (err) {
    return failWithIncident({
      req,
      source: "api:admin:users:mutate",
      message: "Failed to update user",
      error: err,
      userId: session.sub,
      metadata: { id: params.id },
    });
  }
}
