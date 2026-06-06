import { prisma } from "@/lib/prisma";
import { ok, fail } from "@/lib/http";
import { computeSignatureHash } from "@/lib/signature";
import { verifyDscSignature, getDscCertificate } from "@/lib/dsc";

// GET /api/v1/verify/:id — PUBLIC, no auth (Section 7.2). Tamper-evident check.
// Two layers: (1) recompute the SHA-256 integrity digest and compare; (2) verify the
// DSC (RSA-SHA256) signature over that digest with the platform public key — genuine
// non-repudiation. Older hash-only prescriptions fall back to the digest comparison.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const rx = await prisma.prescription.findUnique({
    where: { id: params.id },
    include: { medications: true, doctor: { include: { doctor: true } } },
  });
  if (!rx || !rx.signatureHash || !rx.signedAt) {
    return fail("Prescription not found or not signed", 404, "NOT_FOUND");
  }

  const recomputed = computeSignatureHash({
    prescriptionId: rx.id,
    doctorId: rx.doctorId,
    patientName: rx.patientName,
    signedAt: rx.signedAt.toISOString(),
    medications: rx.medications,
  });
  const digestMatches = recomputed === rx.signatureHash;

  // Cryptographic DSC verification when a signature is present. Verify against the public
  // key matching the cert serial the prescription was signed under, so signatures created
  // before a key rotation still verify — and report THAT certificate's metadata.
  const hasDsc = !!rx.signatureValue;
  const dscValid = hasDsc ? verifyDscSignature(recomputed, rx.signatureValue!, rx.signingCertSerial) : false;
  const authentic = hasDsc ? digestMatches && dscValid : digestMatches;
  const cert = getDscCertificate(rx.signingCertSerial);

  return ok({
    prescriptionId: rx.id,
    authentic,
    status: rx.status,
    signedAt: rx.signedAt,
    doctor: {
      name: rx.doctor.doctor?.fullName ?? "Doctor",
      qualification: rx.doctor.doctor?.qualification,
      mciRegNo: rx.doctor.mciRegNo,
      clinicName: rx.doctor.doctor?.clinicName,
    },
    patientName: rx.patientName,
    medicationCount: rx.medications.length,
    signatureHash: rx.signatureHash,
    signature: hasDsc
      ? {
          type: "DSC",
          algorithm: rx.signatureAlg,
          digestMatches,
          signatureValid: dscValid,
          certSerial: rx.signingCertSerial,
          certSubject: cert.subject,
          certIssuer: cert.issuer,
          certValidFrom: cert.validFrom,
          certValidTo: cert.validTo,
        }
      : { type: "HASH", digestMatches },
  });
}
