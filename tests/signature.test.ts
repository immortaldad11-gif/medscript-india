import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSignatureHash } from "@/lib/signature";

// Prescription integrity digest (Section 5.1). The public /verify endpoint recomputes
// this canonical SHA-256 to detect any post-signing tampering, so the hash must be
// deterministic for identical content and sensitive to every field that matters.

const base = {
  prescriptionId: "rx_123",
  doctorId: "doc_1",
  patientName: "Asha Verma",
  signedAt: "2026-06-06T10:00:00.000Z",
  medications: [
    { drugName: "Amoxicillin", dosage: "500", unit: "mg", frequency: "TID", duration: "5d" },
  ],
};

test("identical content produces an identical 64-char hex digest", () => {
  const a = computeSignatureHash(base);
  const b = computeSignatureHash(JSON.parse(JSON.stringify(base)));
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
});

test("every meaningful field perturbs the digest", () => {
  const baseline = computeSignatureHash(base);
  const mutations = [
    { ...base, prescriptionId: "rx_124" },
    { ...base, doctorId: "doc_2" },
    { ...base, patientName: "Asha Verman" },
    { ...base, signedAt: "2026-06-06T10:00:01.000Z" },
    { ...base, medications: [{ ...base.medications[0], dosage: "250" }] },
    { ...base, medications: [{ ...base.medications[0], unit: "ml" }] },
    { ...base, medications: [{ ...base.medications[0], frequency: "BID" }] },
    { ...base, medications: [{ ...base.medications[0], duration: "7d" }] },
  ];
  for (const m of mutations) {
    assert.notEqual(computeSignatureHash(m), baseline);
  }
});

test("medication ordering is part of the signed content", () => {
  const second = { drugName: "Ibuprofen", dosage: "200", unit: "mg", frequency: "BID", duration: "3d" };
  const ab = computeSignatureHash({ ...base, medications: [base.medications[0], second] });
  const ba = computeSignatureHash({ ...base, medications: [second, base.medications[0]] });
  assert.notEqual(ab, ba, "reordering meds must change the digest");
});

test("adding or removing a medication changes the digest", () => {
  const baseline = computeSignatureHash(base);
  const withExtra = computeSignatureHash({
    ...base,
    medications: [...base.medications, { drugName: "Paracetamol", dosage: "650", unit: "mg", frequency: "SOS", duration: "3d" }],
  });
  assert.notEqual(withExtra, baseline);
});
