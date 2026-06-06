import { prisma } from "@/lib/prisma";
import { getObject } from "@/lib/storage";
import { runOcr } from "@/lib/ocr";
import { notifyWithFallback } from "@/lib/notifications";
import { redis, redisAvailable } from "@/lib/redis";
import { audit } from "@/lib/audit";
import type { ReportType } from "@prisma/client";

// Shared job processors — Section 2.2 async pipeline. These pure functions do the
// actual work and are invoked either inline (when the queue is disabled/unavailable)
// or by the BullMQ worker. Keeping one implementation avoids drift between the two.

// --- OCR: structure an uploaded document and flip its status. ---
export async function processOcrReport(reportId: string): Promise<void> {
  const report = await prisma.medicalReport.findUnique({ where: { id: reportId } });
  if (!report || !report.s3Key) return;
  try {
    const bytes = await getObject(report.s3Key);
    const ocr = await runOcr({
      buffer: bytes,
      mimeType: report.mimeType ?? "application/octet-stream",
      reportType: report.reportType as ReportType,
    });
    await prisma.medicalReport.update({
      where: { id: reportId },
      data: { ocrText: ocr.ocrText, structuredData: ocr.structured as object, ocrStatus: "DONE" },
    });
    await audit({
      entityType: "medical_report",
      entityId: reportId,
      action: "DOCUMENT_OCR_COMPLETED",
      metadata: { confidence: ocr.confidence },
    });
  } catch (err) {
    await prisma.medicalReport
      .update({ where: { id: reportId }, data: { ocrStatus: "FAILED" } })
      .catch(() => undefined);
    throw err; // let BullMQ record the failure / retry
  }
}

// --- Notification: deliver a signed prescription, mark DELIVERED on success. ---
export async function processPrescriptionNotification(prescriptionId: string): Promise<void> {
  const rx = await prisma.prescription.findUnique({
    where: { id: prescriptionId },
    include: { patient: true },
  });
  if (!rx || !rx.patient?.phone) return;

  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
  const result = await notifyWithFallback(
    rx.patient.phone,
    `Your prescription from MedScript India is ready. Verify & view: ${base}/verify/${rx.id}`,
    `${base}/api/v1/prescriptions/${rx.id}/pdf`,
  );

  if (result.delivered && rx.status !== "DELIVERED") {
    await prisma.prescription.update({ where: { id: rx.id }, data: { status: "DELIVERED" } });
  }
  await audit({
    entityType: "prescription",
    entityId: rx.id,
    action: "PRESCRIPTION_DELIVERED",
    metadata: { channel: result.channel, delivered: result.delivered },
  });
}

// --- Maintenance: auto-revoke expired consents (Section 4.3.3). ---
// The lazy expiry in consent.ts handles correctness on read; this proactively flips
// expired ACTIVE consents and purges their Redis TAT keys so they vanish on schedule.
export async function processConsentSweep(): Promise<number> {
  const expired = await prisma.consentArtefact.findMany({
    where: { status: "ACTIVE", expiresAt: { lt: new Date() } },
    include: { accessGrants: true },
  });
  if (expired.length === 0) return 0;

  await prisma.consentArtefact.updateMany({
    where: { id: { in: expired.map((c) => c.id) } },
    data: { status: "EXPIRED" },
  });

  if (redisAvailable() && redis) {
    const keys = expired.flatMap((c) => c.accessGrants.map((g) => "tat:" + g.tempAccessToken));
    if (keys.length) await redis.del(...keys).catch(() => undefined);
  }
  for (const c of expired) {
    await audit({ entityType: "consent_artefact", entityId: c.id, action: "CONSENT_AUTO_EXPIRED" });
  }
  return expired.length;
}
