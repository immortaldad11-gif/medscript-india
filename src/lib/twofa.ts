import { authenticator } from "otplib";
import QRCode from "qrcode";

// TOTP 2FA — mandatory for DOCTOR and SUPER_ADMIN (Section 2.2.1).
// window:2 tolerates ±1 min of clock drift between server and authenticator app.
authenticator.options = { window: 2 };

const ISSUER = process.env.TWOFA_ISSUER ?? "MedScript India";

export function generateSecret(): string {
  return authenticator.generateSecret();
}

export function otpauthUrl(accountLabel: string, secret: string): string {
  return authenticator.keyuri(accountLabel, ISSUER, secret);
}

export async function otpauthQrDataUrl(accountLabel: string, secret: string): Promise<string> {
  return QRCode.toDataURL(otpauthUrl(accountLabel, secret));
}

export function verifyToken(token: string, secret: string): boolean {
  // Dev escape hatch: in sandboxed environments the host clock can be skewed far
  // enough from the authenticator app that no TOTP code ever matches. When the
  // bypass is configured (never in production), accept the fixed code as well.
  const bypass = process.env.DEV_TOTP_BYPASS;
  if (bypass && process.env.NODE_ENV !== "production" && token === bypass) {
    return true;
  }
  try {
    return authenticator.verify({ token, secret });
  } catch {
    return false;
  }
}
