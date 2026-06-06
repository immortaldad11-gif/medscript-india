import crypto from "crypto";
import { randomToken } from "@/lib/crypto";

// ABDM / ABHA integration — Section 2.2 (Ayushman Bharat Digital Mission).
// ABHA (Ayushman Bharat Health Account) gives every citizen a 14-digit health ID plus
// a human-readable ABHA address (e.g. ramesh@abdm). Linking lets a patient carry a
// portable, consent-gated health identity across providers.
//
// Production calls the ABDM Gateway sandbox/prod (https://dev.abdm.gov.in) using the
// M2 enrolment + M3 verification APIs: request an OTP against the ABHA-linked Aadhaar/
// mobile, then exchange (txnId, otp) for the ABHA profile, all over the gateway's
// session token. Phase 1 ships a deterministic local analog with the same shape so the
// link/verify flow, Redis transaction store, encryption, and audit trail are exercised
// end to end. The fixed dev OTP mirrors DEV_TOTP_BYPASS and is ignored in production.

export const ABHA_DEV_OTP = process.env.ABHA_DEV_OTP || "123456";

export interface AbhaIdentifier {
  abhaNumber?: string; // 14 digits, optionally hyphenated
  abhaAddress?: string; // handle@suffix
}

export interface AbhaValidation {
  ok: boolean;
  abhaNumber?: string; // normalized: digits only
  abhaAddress?: string; // normalized: lowercased handle
  reason?: string;
}

const ABHA_SUFFIXES = ["abdm", "sbx", "abha"];

// Normalize + validate an ABHA number (14 digits) or address (handle@suffix).
export function validateAbhaIdentifier(input: AbhaIdentifier): AbhaValidation {
  if (input.abhaNumber) {
    const digits = input.abhaNumber.replace(/[\s-]/g, "");
    if (!/^\d{14}$/.test(digits)) {
      return { ok: false, reason: "ABHA number must be 14 digits (e.g. 12-3456-7890-1234)" };
    }
    return { ok: true, abhaNumber: digits };
  }
  if (input.abhaAddress) {
    const addr = input.abhaAddress.trim().toLowerCase();
    const m = /^([a-z0-9](?:[a-z0-9._]{1,30}[a-z0-9]))@([a-z]+)$/.exec(addr);
    if (!m) return { ok: false, reason: "ABHA address must look like name@abdm" };
    if (!ABHA_SUFFIXES.includes(m[2])) {
      return { ok: false, reason: `Unknown ABHA address suffix @${m[2]}` };
    }
    return { ok: true, abhaAddress: addr };
  }
  return { ok: false, reason: "Provide an ABHA number or ABHA address" };
}

export interface AbhaOtpChallenge {
  txnId: string;
  maskedMobile: string; // e.g. "XXXXXX1234"
  expiresInSec: number;
}

// Step 1 — request an OTP for the identifier. Returns a transaction id the caller
// stores (Redis) and a masked mobile that the OTP was "sent" to.
export function initAbhaOtp(v: AbhaValidation): AbhaOtpChallenge {
  // Derive a stable, plausible masked mobile from the identifier (stub only).
  const seed = (v.abhaNumber ?? v.abhaAddress ?? "0000").replace(/\D/g, "").padStart(4, "0");
  const last4 = seed.slice(-4);
  return { txnId: randomToken(16), maskedMobile: `XXXXXX${last4}`, expiresInSec: 300 };
}

export interface AbhaProfile {
  abhaNumber: string; // 14 digits
  abhaAddress: string; // handle@abdm
  fullName: string;
  gender: string | null;
  yearOfBirth: number | null;
  mobile: string; // masked
  kycVerified: boolean;
}

// Step 2 — exchange a verified OTP for the ABHA profile. In production this is the
// gateway response; here we synthesize a deterministic profile from the identifier.
export function fetchAbhaProfile(v: AbhaValidation, knownName?: string): AbhaProfile {
  const abhaNumber =
    v.abhaNumber ??
    // Derive a deterministic 14-digit number from the address handle when only the
    // address was supplied (stub: real gateway returns the canonical number).
    deriveNumberFromAddress(v.abhaAddress!);
  const abhaAddress = v.abhaAddress ?? `${abhaNumber.slice(0, 8)}@abdm`;
  return {
    abhaNumber,
    abhaAddress,
    fullName: knownName ?? "ABHA Holder",
    gender: null,
    yearOfBirth: null,
    mobile: `XXXXXX${abhaNumber.slice(-4)}`,
    kycVerified: true,
  };
}

function deriveNumberFromAddress(address: string): string {
  let h = 0;
  for (const ch of address) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return String(h).padStart(14, "0").slice(0, 14);
}

// --- Stateless OTP transaction (HMAC-signed, time-limited; no external store) ---
// Mirrors the presigned-URL pattern in storage.ts. The txnId carries the validated
// identifier + owner + expiry, signed so the verify step can trust it without Redis.

const TXN_SECRET = process.env.JWT_ACCESS_SECRET ?? "dev-access-secret-change-me";

interface AbhaTxnPayload {
  userId: string;
  abhaNumber?: string;
  abhaAddress?: string;
  exp: number; // epoch ms
}

export function signAbhaTxn(userId: string, v: AbhaValidation, ttlSeconds = 300): string {
  const payload: AbhaTxnPayload = {
    userId,
    abhaNumber: v.abhaNumber,
    abhaAddress: v.abhaAddress,
    exp: Date.now() + ttlSeconds * 1000,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", TXN_SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyAbhaTxn(txnId: string, userId: string): AbhaValidation | null {
  const [body, sig] = txnId.split(".");
  if (!body || !sig) return null;
  const expected = crypto.createHmac("sha256", TXN_SECRET).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload: AbhaTxnPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (payload.userId !== userId || payload.exp < Date.now()) return null;
  return { ok: true, abhaNumber: payload.abhaNumber, abhaAddress: payload.abhaAddress };
}

// Hyphenate a 14-digit number for display: 12-3456-7890-1234.
export function formatAbhaNumber(digits: string): string {
  if (!/^\d{14}$/.test(digits)) return digits;
  return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6, 10)}-${digits.slice(10)}`;
}

// Mask all but the last 4 digits for display where the full number isn't needed.
export function maskAbhaNumber(digits: string): string {
  if (!/^\d{14}$/.test(digits)) return "••••";
  return `XX-XXXX-XXXX-${digits.slice(10)}`;
}
