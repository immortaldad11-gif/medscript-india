import type { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ok, fail, failWithIncident } from "@/lib/http";
import { AuthError, requireAuth } from "@/lib/auth";

// GET /api/v1/documents — scoped by role:
//   PATIENT            → their own documents
//   LAB_TECH/RADIOLOGY → documents they uploaded (for any patient)
//   SUPER_ADMIN        → all documents
export async function GET(req: NextRequest) {
  try {
    const session = requireAuth(req);
    const isStaff = session.role === "LAB_TECHNICIAN" || session.role === "RADIOLOGIST";
    const where: Prisma.MedicalReportWhereInput =
      session.role === "SUPER_ADMIN" ? {} : isStaff ? { uploadedById: session.sub } : { patientId: session.sub };

    const rows = await prisma.medicalReport.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        title: true,
        reportType: true,
        originalFilename: true,
        mimeType: true,
        sizeBytes: true,
        isVerified: true,
        ocrStatus: true,
        createdAt: true,
        patient: { select: { phone: true, patient: { select: { fullName: true } } } },
      },
    });

    const data = rows.map((r) => ({
      id: r.id,
      title: r.title,
      reportType: r.reportType,
      originalFilename: r.originalFilename,
      mimeType: r.mimeType,
      sizeBytes: r.sizeBytes,
      isVerified: r.isVerified,
      ocrStatus: r.ocrStatus,
      createdAt: r.createdAt,
      patientName: r.patient?.patient?.fullName ?? null,
      patientPhone: r.patient?.phone ?? null,
    }));
    return ok(data);
  } catch (err) {
    if (err instanceof AuthError) return fail(err.message, err.status, err.code);
    return failWithIncident({ req, source: "api:documents:list", message: "Failed to load documents", error: err });
  }
}
