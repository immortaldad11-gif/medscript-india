import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { computeSignatureHash } from "@/lib/signature";
import { verifyDscSignature, getDscCertificate } from "@/lib/dsc";

// Public, no-auth tamper-evident verification page (Section 4.3 / 7.2).
// Mirrors GET /api/v1/verify/:id: recompute the SHA-256 integrity digest AND perform
// genuine RSA-SHA256 DSC verification against the certificate the prescription was
// signed under (so it still verifies after a key rotation). The issuing certificate
// chain is surfaced for the verifier (IT Act 2000 §3).
export default async function VerifyPage({ params }: { params: { id: string } }) {
  const rx = await prisma.prescription.findUnique({
    where: { id: params.id },
    include: { medications: true, doctor: { include: { doctor: true } } },
  });

  const valid = !!(rx && rx.signatureHash && rx.signedAt);

  const recomputed = valid
    ? computeSignatureHash({
        prescriptionId: rx!.id,
        doctorId: rx!.doctorId,
        patientName: rx!.patientName,
        signedAt: rx!.signedAt!.toISOString(),
        medications: rx!.medications,
      })
    : null;

  const digestMatches = valid && recomputed === rx!.signatureHash;
  const hasDsc = valid && !!rx!.signatureValue;
  const dscValid = hasDsc ? verifyDscSignature(recomputed!, rx!.signatureValue!, rx!.signingCertSerial) : false;
  const authentic = hasDsc ? digestMatches && dscValid : digestMatches;
  const cert = hasDsc ? getDscCertificate(rx!.signingCertSerial) : null;

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="card w-full max-w-lg p-8">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-lg bg-brand-600" />
          <span className="font-bold text-brand-700">MedScript India</span>
        </div>
        <h1 className="mt-4 text-xl font-bold text-slate-900">Prescription verification</h1>

        {!valid ? (
          <div className="mt-6 rounded-lg border border-red-300 bg-red-50 p-4 text-red-800">
            <p className="font-semibold">Not found</p>
            <p className="mt-1 text-sm">No signed prescription matches this code.</p>
          </div>
        ) : (
          <>
            <div
              className={`mt-6 rounded-lg border p-4 ${
                authentic ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-red-300 bg-red-50 text-red-800"
              }`}
            >
              <p className="text-lg font-semibold">{authentic ? "✓ Authentic & untampered" : "✗ Verification failed"}</p>
              <p className="mt-1 text-sm">
                {authentic
                  ? hasDsc
                    ? "The RSA-SHA256 digital signature verifies against the issuing certificate and matches the prescription contents."
                    : "The integrity digest matches the prescription contents."
                  : "The signature does not match — this document may have been altered."}
              </p>
            </div>

            <dl className="mt-6 space-y-2 text-sm">
              <Row label="Prescription ID" value={rx!.id} />
              <Row label="Status" value={rx!.status} />
              <Row label="Signed at" value={rx!.signedAt!.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} />
              <Row label="Doctor" value={rx!.doctor.doctor?.fullName ?? "Doctor"} />
              <Row label="Reg. No." value={rx!.doctor.mciRegNo ?? "—"} />
              <Row label="Clinic" value={rx!.doctor.doctor?.clinicName ?? "—"} />
              <Row label="Patient" value={rx!.patientName} />
              <Row label="Medications" value={String(rx!.medications.length)} />
            </dl>

            {hasDsc && cert ? (
              <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Digital Signature Certificate</p>

                <div className="mt-3 flex items-center gap-2 text-sm">
                  <CheckPill ok={dscValid} label={dscValid ? "Signature valid" : "Signature invalid"} />
                  <CheckPill ok={digestMatches} label={digestMatches ? "Contents intact" : "Contents altered"} />
                </div>

                {/* Issuing chain: signing certificate → issuing CA */}
                <div className="mt-4 space-y-2">
                  <ChainNode role="Signed by" dn={cert.subject} serial={rx!.signingCertSerial} />
                  <div className="ml-2 h-3 border-l border-slate-300" />
                  <ChainNode role="Issued by (CA)" dn={cert.issuer} />
                </div>

                <dl className="mt-4 space-y-1.5 text-xs">
                  <Row label="Algorithm" value={cert.algorithm} />
                  <Row label="Certificate serial" value={rx!.signingCertSerial ?? "—"} mono />
                  <Row
                    label="Certificate validity"
                    value={`${new Date(cert.validFrom).toLocaleDateString("en-IN")} – ${new Date(cert.validTo).toLocaleDateString("en-IN")}`}
                  />
                </dl>
              </div>
            ) : (
              <p className="mt-4 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-500">
                This prescription carries an integrity hash only (it predates DSC signing).
              </p>
            )}

            <p className="mt-4 break-all text-xs text-slate-400">Integrity digest (SHA-256): {rx!.signatureHash}</p>
          </>
        )}

        <p className="mt-8 text-center text-xs text-slate-400">
          <Link href="/" className="text-brand-600">MedScript India</Link> · Valid under Telemedicine Practice Guidelines 2020
        </p>
      </div>
    </main>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-100 pb-1">
      <dt className="shrink-0 text-slate-500">{label}</dt>
      <dd className={`text-right font-medium text-slate-800 ${mono ? "break-all font-mono" : ""}`}>{value}</dd>
    </div>
  );
}

function CheckPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex h-6 items-center rounded-full px-2 text-xs font-semibold ${
        ok ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
      }`}
    >
      {ok ? "✓" : "✗"} {label}
    </span>
  );
}

function ChainNode({ role, dn, serial }: { role: string; dn: string; serial?: string | null }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{role}</p>
      <p className="text-sm text-slate-800">{dn}</p>
      {serial ? <p className="mt-0.5 font-mono text-[11px] text-slate-400">Serial {serial}</p> : null}
    </div>
  );
}
