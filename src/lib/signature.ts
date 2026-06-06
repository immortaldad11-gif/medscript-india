import { sha256 } from "@/lib/crypto";

// Prescription integrity signature — Section 5.1 (SHA-256 prescription integrity
// hashes). Production applies a CCA-licensed DSC (eMudhra) over this digest; Phase 1
// stores the digest itself, which the public /verify endpoint recomputes to detect
// tampering.
export function computeSignatureHash(input: {
  prescriptionId: string;
  doctorId: string;
  patientName: string;
  signedAt: string;
  medications: Array<{ drugName: string; dosage: string; unit: string; frequency: string; duration: string }>;
}): string {
  const canonical = JSON.stringify({
    id: input.prescriptionId,
    doctor: input.doctorId,
    patient: input.patientName,
    signedAt: input.signedAt,
    meds: input.medications.map((m) => ({
      n: m.drugName,
      d: m.dosage,
      u: m.unit,
      f: m.frequency,
      du: m.duration,
    })),
  });
  return sha256(canonical);
}
