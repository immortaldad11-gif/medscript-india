import type { NextRequest } from "next/server";
import type { Prisma, Role, KycStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ok, fail, failWithIncident } from "@/lib/http";
import { AuthError, requireAuth } from "@/lib/auth";

// GET /api/v1/admin/users — Section 2.4 administration.
// SUPER_ADMIN roster of platform accounts. Filters: ?role=, ?kyc=PENDING|VERIFIED|REJECTED,
// ?status=active|inactive|all (default all), ?q=<phone/email/name contains>. Returns shaped
// users plus headline counts (total, pending KYC, suspended) for the dashboard badges.
const ROLES = ["SUPER_ADMIN", "DOCTOR", "PATIENT", "LAB_TECHNICIAN", "RADIOLOGIST"];
const KYCS = ["PENDING", "VERIFIED", "REJECTED"];

export async function GET(req: NextRequest) {
  try {
    requireAuth(req, ["SUPER_ADMIN"]);
    const url = new URL(req.url);
    const role = url.searchParams.get("role")?.toUpperCase();
    const kyc = url.searchParams.get("kyc")?.toUpperCase();
    const status = (url.searchParams.get("status") ?? "all").toLowerCase();
    const q = url.searchParams.get("q")?.trim();
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 100, 1), 500);

    const where: Prisma.UserWhereInput = {};
    if (role && ROLES.includes(role)) where.role = role as Role;
    if (kyc && KYCS.includes(kyc)) where.kycStatus = kyc as KycStatus;
    if (status === "active") where.isActive = true;
    else if (status === "inactive") where.isActive = false;
    if (q) {
      where.OR = [
        { phone: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { mciRegNo: { contains: q, mode: "insensitive" } },
        { doctor: { fullName: { contains: q, mode: "insensitive" } } },
        { patient: { fullName: { contains: q, mode: "insensitive" } } },
      ];
    }

    const [users, total, pendingKyc, suspended] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        include: {
          doctor: { select: { fullName: true, specialisation: true, clinicName: true } },
          patient: { select: { fullName: true } },
        },
      }),
      prisma.user.count(),
      prisma.user.count({ where: { kycStatus: "PENDING" } }),
      prisma.user.count({ where: { isActive: false } }),
    ]);

    const shaped = users.map((u) => ({
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
      // Lets the UI disable role assignments that would orphan a profile-bound role.
      hasDoctorProfile: !!u.doctor,
      hasPatientProfile: !!u.patient,
    }));

    return ok({ users: shaped, total, pendingKyc, suspended });
  } catch (err) {
    if (err instanceof AuthError) return fail(err.message, err.status, err.code);
    return failWithIncident({ req, source: "api:admin:users:list", message: "Failed to load users", error: err });
  }
}
