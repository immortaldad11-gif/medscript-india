import type { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ok, fail, failWithIncident } from "@/lib/http";
import { AuthError, requireAuth } from "@/lib/auth";

// Local-time YYYY-MM-DD key (avoids the UTC day-shift that toISOString() causes).
function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// GET /api/v1/analytics — practice/platform insights (Section 4.4 reporting).
// Doctors see their own activity; SUPER_ADMIN sees platform-wide.
export async function GET(req: NextRequest) {
  try {
    const session = requireAuth(req, ["DOCTOR", "SUPER_ADMIN"]);
    const isAdmin = session.role === "SUPER_ADMIN";

    const rxWhere: Prisma.PrescriptionWhereInput = isAdmin ? {} : { doctorId: session.sub };
    const medWhere: Prisma.MedicationWhereInput = isAdmin ? {} : { prescription: { doctorId: session.sub } };
    const flagWhere: Prisma.InteractionFlagWhereInput = isAdmin ? {} : { prescription: { doctorId: session.sub } };

    const since = new Date();
    since.setDate(since.getDate() - 13);
    since.setHours(0, 0, 0, 0);

    const [
      total,
      signed,
      delivered,
      distinctPatients,
      flaggedRx,
      overrides,
      recent,
      topDrugsRaw,
      scheduleRaw,
      severityRaw,
    ] = await Promise.all([
      prisma.prescription.count({ where: rxWhere }),
      prisma.prescription.count({ where: { ...rxWhere, status: { in: ["SIGNED", "DELIVERED"] } } }),
      prisma.prescription.count({ where: { ...rxWhere, status: "DELIVERED" } }),
      prisma.prescription.findMany({ where: rxWhere, select: { patientId: true }, distinct: ["patientId"] }),
      prisma.prescription.count({ where: { ...rxWhere, interactions: { some: {} } } }),
      prisma.interactionFlag.count({ where: { ...flagWhere, overridden: true } }),
      prisma.prescription.findMany({
        where: { ...rxWhere, createdAt: { gte: since } },
        select: { createdAt: true },
      }),
      prisma.medication.groupBy({
        by: ["drugName"],
        where: medWhere,
        _count: { drugName: true },
        orderBy: { _count: { drugName: "desc" } },
        take: 8,
      }),
      prisma.medication.groupBy({
        by: ["drugSchedule"],
        where: medWhere,
        _count: { drugSchedule: true },
      }),
      prisma.interactionFlag.groupBy({
        by: ["severity"],
        where: flagWhere,
        _count: { severity: true },
      }),
    ]);

    // Bucket prescriptions into the last 14 calendar days (local time, not UTC).
    const byDay: { date: string; count: number }[] = [];
    const buckets = new Map<string, number>();
    for (let i = 0; i < 14; i++) {
      const d = new Date(since);
      d.setDate(since.getDate() + i);
      const key = dayKey(d);
      buckets.set(key, 0);
      byDay.push({ date: key, count: 0 });
    }
    for (const r of recent) {
      const key = dayKey(r.createdAt);
      if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
    for (const entry of byDay) entry.count = buckets.get(entry.date) ?? 0;

    // Admin-only platform metrics.
    let platform: { documents: number; activeConsents: number; doctors: number; patients: number } | null = null;
    if (isAdmin) {
      const [documents, activeConsents, doctors, patients] = await Promise.all([
        prisma.medicalReport.count(),
        prisma.consentArtefact.count({ where: { status: "ACTIVE", expiresAt: { gt: new Date() } } }),
        prisma.user.count({ where: { role: "DOCTOR" } }),
        prisma.user.count({ where: { role: "PATIENT" } }),
      ]);
      platform = { documents, activeConsents, doctors, patients };
    }

    return ok({
      scope: isAdmin ? "platform" : "doctor",
      summary: {
        totalPrescriptions: total,
        signed,
        delivered,
        distinctPatients: distinctPatients.length,
        flaggedPrescriptions: flaggedRx,
        interactionOverrides: overrides,
      },
      prescriptionsByDay: byDay,
      topDrugs: topDrugsRaw.map((d) => ({ drugName: d.drugName, count: d._count.drugName })),
      scheduleDistribution: scheduleRaw.map((s) => ({ schedule: s.drugSchedule, count: s._count.drugSchedule })),
      interactionsBySeverity: severityRaw.map((s) => ({ severity: s.severity, count: s._count.severity })),
      platform,
    });
  } catch (err) {
    if (err instanceof AuthError) return fail(err.message, err.status, err.code);
    return failWithIncident({ req, source: "api:analytics", message: "Failed to load analytics", error: err });
  }
}
