// MCI/NMC registration verification — Section 2.2.1.
// Production calls the NMC registry / HPR API. Phase 1 ships a deterministic stub
// that accepts well-formed registration numbers and rejects obvious placeholders,
// so the onboarding flow and audit trail are exercised end to end.

export interface MciVerificationResult {
  verified: boolean;
  reason?: string;
}

export async function verifyMciRegistration(regNo: string, _doctorName: string): Promise<MciVerificationResult> {
  const trimmed = regNo.trim();
  if (trimmed.length < 4) {
    return { verified: false, reason: "Registration number too short" };
  }
  if (/^(0+|test|fake|none)$/i.test(trimmed)) {
    return { verified: false, reason: "Registration number appears invalid" };
  }
  // Stub: treat any plausibly-formatted number as verified.
  return { verified: true };
}
