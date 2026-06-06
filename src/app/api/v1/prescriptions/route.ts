import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, fail, failWithIncident } from "@/lib/http";
import { AuthError, requireAuth } from "@/lib/auth";
import { createPrescriptionSchema } from "@/lib/validation";
import { validateMedications, detectInteractions } from "@/lib/drug-schedules";
import { resolvePatient } from "@/lib/patients";
import { computeSignatureHash } from "@/lib/signature";
import { signWithDsc } from "@/lib/dsc";
import { enqueuePrescriptionNotification } from "@/lib/queue";
import { audit, clientIp } from "@/lib/audit";
import type { DrugSchedule } from "@prisma/client";

// GET /api/v1/prescriptions — list the doctor's own prescriptions (or patient's).
export async function GET(req: NextRequest) {
  try {
    const session = requireAuth(req);
    const where =
      session.role === "DOCTOR"
        ? { doctorId: session.sub }
        : session.role === "PATIENT"
          ? { patientId: session.sub }
          : {}; // SUPER_ADMIN sees all

    const rows = await prisma.prescription.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { medications: true, interactions: true },
    });
    return ok(rows);
  } catch (err) {
    if (err instanceof AuthError) return fail(err.message, err.status, err.code);
    return failWithIncident({ req, source: "api:prescriptions:list", message: "Failed to load prescriptions", error: err });
  }
}

// POST /api/v1/prescriptions — create a prescription (doctor only).
// Runs schedule validation (X = hard block), interaction checks (CONTRAINDICATED
// requires typed override), persists, signs, and dispatches WhatsApp delivery.
export async function POST(req: NextRequest) {
  let session;
  try {
    session = requireAuth(req, ["DOCTOR"]);
  } catch (err) {
    if (err instanceof AuthError) return fail(err.message, err.status, err.code);
    throw err;
  }

  const body = await req.json().catch(() => null);
  const parsed = createPrescriptionSchema.safeParse(body);
  if (!parsed.success) return fail("Validation failed", 422, "VALIDATION_ERROR", parsed.error.flatten());
  const input = parsed.data;

  // Idempotency — prevent duplicate submissions (Section 7.1).
  if (input.idempotencyKey) {
    const existing = await prisma.auditLog.findFirst({
      where: { action: "PRESCRIPTION_CREATED", performedById: session.sub, metadata: { path: ["idempotencyKey"], equals: input.idempotencyKey } },
    });
    if (existing?.entityId) {
      const dup = await prisma.prescription.findUnique({ where: { id: existing.entityId }, include: { medications: true, interactions: true } });
      if (dup) return ok(dup, 200);
    }
  }

  // 1. Schedule validation.
  const validations = await validateMedications(input.medications);
  const blocked = validations.filter((v) => !v.rule.allowed);
  if (blocked.length > 0) {
    return fail(
      "One or more medications cannot be prescribed via telemedicine",
      422,
      "SCHEDULE_BLOCKED",
      { blocked: blocked.map((b) => ({ drugName: b.drugName, schedule: b.resolvedSchedule, reason: b.rule.reason })) },
    );
  }
  const scheduleByName = new Map(validations.map((v) => [v.drugName.toLowerCase(), v.resolvedSchedule]));

  // 2. Interaction checks.
  const interactions = await detectInteractions(input.medications.map((m) => m.drugName));
  const contraindicated = interactions.filter((i) => i.severity === "CONTRAINDICATED");
  const overrides = input.interactionOverrides ?? [];
  const unjustified = contraindicated.filter(
    (c) =>
      !overrides.some(
        (o) =>
          (o.drugA.toLowerCase() === c.drugA.toLowerCase() && o.drugB.toLowerCase() === c.drugB.toLowerCase()) ||
          (o.drugA.toLowerCase() === c.drugB.toLowerCase() && o.drugB.toLowerCase() === c.drugA.toLowerCase()),
      ),
  );
  if (unjustified.length > 0) {
    return fail(
      "Contraindicated drug interactions require a typed clinical justification",
      409,
      "INTERACTION_OVERRIDE_REQUIRED",
      { interactions },
    );
  }

  // 3. Resolve patient.
  const patient = await resolvePatient({
    patientId: input.patientId,
    patientPhone: input.patientPhone,
    patientName: input.patientName,
  });
  if (!patient) return fail("Patient not found — provide a valid patientId or patientPhone", 422, "PATIENT_NOT_FOUND");

  // 4. Persist (prescription + medications + interaction flags), then sign.
  const created = await prisma.$transaction(async (tx) => {
    const rx = await tx.prescription.create({
      data: {
        doctorId: session!.sub,
        patientId: patient.id,
        patientName: input.patientName,
        chiefComplaint: input.chiefComplaint,
        diagnosisIcd10: input.diagnosisIcd10,
        diagnosisText: input.diagnosisText,
        notes: input.notes,
        followUpDate: input.followUpDate ? new Date(input.followUpDate) : undefined,
        vitals: input.vitals,
        status: "DRAFT",
        modifiedBy: session!.sub,
        medications: {
          create: input.medications.map((m) => ({
            drugName: m.drugName,
            drugSchedule: (scheduleByName.get(m.drugName.toLowerCase()) ?? "H") as DrugSchedule,
            dosage: m.dosage,
            unit: m.unit,
            frequency: m.frequency,
            duration: m.duration,
            route: m.route,
            instructions: m.instructions,
            prn: m.prn ?? false,
          })),
        },
        interactions: {
          create: interactions.map((i) => {
            const ov = overrides.find(
              (o) =>
                (o.drugA.toLowerCase() === i.drugA.toLowerCase() && o.drugB.toLowerCase() === i.drugB.toLowerCase()) ||
                (o.drugA.toLowerCase() === i.drugB.toLowerCase() && o.drugB.toLowerCase() === i.drugA.toLowerCase()),
            );
            return {
              drugA: i.drugA,
              drugB: i.drugB,
              severity: i.severity,
              description: i.description,
              overridden: !!ov,
              justification: ov?.justification,
            };
          }),
        },
      },
      include: { medications: true, interactions: true },
    });

    const signedAt = new Date();
    const signatureHash = computeSignatureHash({
      prescriptionId: rx.id,
      doctorId: session!.sub,
      patientName: rx.patientName,
      signedAt: signedAt.toISOString(),
      medications: rx.medications,
    });
    // Apply the platform DSC over the integrity digest (IT Act §3 digital signature).
    const dsc = signWithDsc(signatureHash);
    // Record the DSC certificate serial on the doctor profile for their records.
    await tx.doctor.updateMany({ where: { userId: session!.sub }, data: { digitalSigCertId: dsc.certSerial } });

    return tx.prescription.update({
      where: { id: rx.id },
      data: {
        status: "SIGNED",
        signedAt,
        signatureHash,
        signatureValue: dsc.signatureValue,
        signatureAlg: dsc.algorithm,
        signingCertSerial: dsc.certSerial,
        pdfS3Key: `prescriptions/${rx.id}.pdf`,
      },
      include: { medications: true, interactions: true },
    });
  });

  await audit({
    entityType: "prescription",
    entityId: created.id,
    action: "PRESCRIPTION_CREATED",
    performedById: session.sub,
    ipAddress: clientIp(req),
    metadata: { idempotencyKey: input.idempotencyKey, medications: created.medications.length, interactions: created.interactions.length },
  });

  // 5. Dispatch delivery — async via BullMQ when enabled, inline otherwise. When
  // queued, the prescription stays SIGNED until the worker confirms delivery.
  if (patient.phone) {
    const { queued } = await enqueuePrescriptionNotification(created.id);
    if (!queued) {
      const after = await prisma.prescription.findUnique({ where: { id: created.id } });
      if (after) created.status = after.status;
    }
  }

  return ok(created, 201);
}
