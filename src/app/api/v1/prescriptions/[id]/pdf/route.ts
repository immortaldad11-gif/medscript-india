import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { fail } from "@/lib/http";
import { getSession } from "@/lib/auth";
import { generatePrescriptionPdf } from "@/lib/pdf";
import { decryptField } from "@/lib/crypto";
import { maskAbhaNumber } from "@/lib/abdm";

// GET /api/v1/prescriptions/:id/pdf — render the signed prescription PDF.
// Access: doctor/patient owner or admin. (WhatsApp delivery links here; in
// production this would be a time-limited presigned S3 URL — Section 5.2.)
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = getSession(req);

  const rx = await prisma.prescription.findUnique({
    where: { id: params.id },
    include: {
      medications: true,
      doctor: { include: { doctor: true } },
      patient: { include: { patient: true } },
    },
  });
  if (!rx) return fail("Prescription not found", 404, "NOT_FOUND");

  const isOwner = session && (session.role === "SUPER_ADMIN" || rx.doctorId === session.sub || rx.patientId === session.sub);
  if (!isOwner) return fail("You do not have access to this document", 403, "FORBIDDEN");

  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
  const allergies = Array.isArray(rx.patient.patient?.allergies) ? (rx.patient.patient!.allergies as string[]) : [];

  // ABHA number is encrypted at rest; surface only the masked form on the document.
  let abhaNumber: string | null = null;
  if (rx.patient.abhaId) {
    try {
      abhaNumber = maskAbhaNumber(decryptField(rx.patient.abhaId));
    } catch {
      abhaNumber = null;
    }
  }

  const pdf = await generatePrescriptionPdf({
    prescriptionId: rx.id,
    issuedAt: rx.signedAt ?? rx.createdAt,
    clinic: {
      name: rx.doctor.doctor?.clinicName ?? "MedScript Clinic",
      address: rx.doctor.doctor?.clinicAddress,
      gstin: rx.doctor.doctor?.gstin,
    },
    doctor: {
      name: rx.doctor.doctor?.fullName ?? "Doctor",
      qualification: rx.doctor.doctor?.qualification,
      mciRegNo: rx.doctor.mciRegNo,
      phone: rx.doctor.phone,
    },
    patient: {
      name: rx.patientName,
      abhaNumber, // masked 14-digit ABHA number (decrypted then masked)
      abhaAddress: rx.patient.abhaAddress, // ABHA address handle (e.g. ramesh@abdm)
      gender: rx.patient.patient?.gender,
      bloodGroup: rx.patient.patient?.bloodGroup,
      allergies,
    },
    diagnosis: rx.diagnosisText ?? rx.diagnosisIcd10,
    chiefComplaint: rx.chiefComplaint,
    notes: rx.notes,
    followUpDate: rx.followUpDate,
    medications: rx.medications.map((m) => ({
      drugName: m.drugName,
      schedule: m.drugSchedule,
      dosage: m.dosage,
      unit: m.unit,
      frequency: m.frequency,
      duration: m.duration,
      instructions: m.instructions,
    })),
    verifyUrl: `${base}/verify/${rx.id}`,
    signatureHash: rx.signatureHash ?? "unsigned",
    signatureAlg: rx.signatureAlg,
    signingCertSerial: rx.signingCertSerial,
  });

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="prescription-${rx.id}.pdf"`,
    },
  });
}
