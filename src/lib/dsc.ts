import crypto from "crypto";
import fs from "fs";
import path from "path";

// Digital Signature Certificate (DSC) signing — Section 5.1.
// Under the IT Act 2000 §3 and the Telemedicine Practice Guidelines 2020, a digital
// prescription must carry a digital signature from a CCA-licensed Certifying Authority
// (eMudhra, Sify, (n)Code). In production the private key never leaves an HSM / crypto
// token and signing happens through the CA's API or PKCS#11.
//
// Phase 1 ships a faithful local analog: a persisted RSA-2048 keyring stands in for the
// platform DSC. We RSA-SHA256-sign the canonical prescription digest, store the base64
// signature plus the certificate serial used, and the public /verify endpoint performs
// genuine asymmetric verification — real non-repudiation, not just a recomputable hash.
//
// Rotation: the keyring keeps the active signing key AND every retired key. Each
// signature records its certificate serial, and verification selects the public key by
// that serial — so prescriptions signed under an older certificate keep verifying after
// a rotation, exactly as they would against a renewed CA-issued DSC. Swapping in eMudhra
// later only changes how the keyring is sourced (env PEMs below short-circuit to the
// HSM-managed key, where rotation is handled out-of-band by the CA).

const KEY_DIR = path.join(process.cwd(), "storage", ".dsc");
const KEY_FILE = path.join(KEY_DIR, "platform-dsc.json");
const ALGORITHM = "RSA-SHA256";

interface DscKeyMaterial {
  privateKeyPem: string;
  publicKeyPem: string;
  certSerial: string; // 16 hex chars, eMudhra-style serial
  subject: string;
  issuer: string;
  validFrom: string;
  validTo: string;
}

// A keyring holds the active signing key plus all retired keys so older signatures stay
// verifiable after a rotation. `envManaged` marks a keyring sourced from env/HSM PEMs,
// where in-app rotation is disabled (the CA owns the lifecycle).
interface DscKeyring {
  activeSerial: string;
  keys: DscKeyMaterial[];
  envManaged?: boolean;
}

let cached: DscKeyring | null = null;

function generateKeyMaterial(): DscKeyMaterial {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const now = new Date();
  const twoYears = new Date(now.getTime() + 2 * 365 * 24 * 3600 * 1000);
  return {
    privateKeyPem: privateKey,
    publicKeyPem: publicKey,
    certSerial: crypto.randomBytes(8).toString("hex").toUpperCase(),
    subject: "CN=MedScript India Signing Service, O=MedScript India, C=IN",
    issuer: "CN=eMudhra Sub CA for Class 3 Individual 2022, O=eMudhra Limited, C=IN",
    validFrom: now.toISOString(),
    validTo: twoYears.toISOString(),
  };
}

// Keyring from explicit env PEMs (production / HSM export). When present this takes
// priority and rotation is disabled — the CA renews the certificate out-of-band.
function envKeyring(): DscKeyring | null {
  const envPriv = process.env.DSC_PRIVATE_KEY_PEM;
  const envPub = process.env.DSC_PUBLIC_KEY_PEM;
  if (!envPriv || !envPub) return null;
  const key: DscKeyMaterial = {
    privateKeyPem: Buffer.from(envPriv, "base64").toString("utf8"),
    publicKeyPem: Buffer.from(envPub, "base64").toString("utf8"),
    certSerial: process.env.DSC_CERT_SERIAL ?? "ENV0000000000000",
    subject: process.env.DSC_SUBJECT ?? "CN=MedScript India Signing Service, O=MedScript India, C=IN",
    issuer: process.env.DSC_ISSUER ?? "CN=CCA India, O=Controller of Certifying Authorities, C=IN",
    validFrom: process.env.DSC_VALID_FROM ?? new Date().toISOString(),
    validTo: process.env.DSC_VALID_TO ?? new Date(Date.now() + 2 * 365 * 24 * 3600 * 1000).toISOString(),
  };
  return { activeSerial: key.certSerial, keys: [key], envManaged: true };
}

function persist(keyring: DscKeyring): void {
  try {
    fs.mkdirSync(KEY_DIR, { recursive: true });
    fs.writeFileSync(KEY_FILE, JSON.stringify(keyring, null, 2), { mode: 0o600 });
  } catch (err) {
    console.warn("[dsc] could not persist keyring (in-memory only):", (err as Error).message);
  }
}

// Load the keyring. Priority: env PEMs → on-disk keyring (migrating the legacy
// single-key file if needed) → freshly generated (then persisted) dev keyring.
function loadKeyring(): DscKeyring {
  if (cached) return cached;

  const env = envKeyring();
  if (env) {
    cached = env;
    return cached;
  }

  try {
    if (fs.existsSync(KEY_FILE)) {
      const raw = JSON.parse(fs.readFileSync(KEY_FILE, "utf8")) as Partial<DscKeyMaterial> & Partial<DscKeyring>;
      // Migrate the legacy single-key format → keyring.
      if (raw.privateKeyPem && !raw.keys) {
        const legacy = raw as DscKeyMaterial;
        cached = { activeSerial: legacy.certSerial, keys: [legacy] };
        persist(cached);
        return cached;
      }
      if (raw.keys && raw.activeSerial) {
        cached = raw as DscKeyring;
        return cached;
      }
    }
  } catch (err) {
    console.warn("[dsc] failed to read persisted keyring, regenerating:", (err as Error).message);
  }

  const material = generateKeyMaterial();
  cached = { activeSerial: material.certSerial, keys: [material] };
  persist(cached);
  return cached;
}

function activeKey(): DscKeyMaterial {
  const ring = loadKeyring();
  return ring.keys.find((k) => k.certSerial === ring.activeSerial) ?? ring.keys[0];
}

function keyBySerial(serial: string | null | undefined): DscKeyMaterial | null {
  if (!serial) return null;
  return loadKeyring().keys.find((k) => k.certSerial === serial) ?? null;
}

export interface DscSignature {
  signatureValue: string; // base64 RSA-SHA256 signature
  algorithm: string; // "RSA-SHA256"
  certSerial: string;
}

// Sign a canonical string (the prescription digest payload) with the active DSC key.
export function signWithDsc(canonical: string): DscSignature {
  const km = activeKey();
  const signature = crypto.sign(ALGORITHM, Buffer.from(canonical, "utf8"), km.privateKeyPem);
  return { signatureValue: signature.toString("base64"), algorithm: ALGORITHM, certSerial: km.certSerial };
}

// Verify a base64 signature against the canonical string. When the signing cert serial
// is known we use exactly that public key; otherwise (legacy/unknown serial) we make a
// best-effort attempt against every key in the keyring.
export function verifyDscSignature(canonical: string, signatureValue: string, certSerial?: string | null): boolean {
  try {
    const ring = loadKeyring();
    const data = Buffer.from(canonical, "utf8");
    const sig = Buffer.from(signatureValue, "base64");
    const named = keyBySerial(certSerial);
    const candidates = named ? [named] : ring.keys;
    return candidates.some((k) => {
      try {
        return crypto.verify(ALGORITHM, data, k.publicKeyPem, sig);
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

export interface DscCertificate {
  serial: string;
  subject: string;
  issuer: string;
  validFrom: string;
  validTo: string;
  algorithm: string;
  publicKeyPem: string;
  active: boolean;
}

function toCert(km: DscKeyMaterial, active: boolean): DscCertificate {
  return {
    serial: km.certSerial,
    subject: km.subject,
    issuer: km.issuer,
    validFrom: km.validFrom,
    validTo: km.validTo,
    algorithm: ALGORITHM,
    publicKeyPem: km.publicKeyPem,
    active,
  };
}

// Non-sensitive certificate metadata for the public verify endpoint / PDF footer.
// Pass the serial a prescription was signed under to get THAT certificate (so a
// rotated-away cert still reports its own subject/issuer); omit for the active cert.
export function getDscCertificate(serial?: string | null): DscCertificate {
  const ring = loadKeyring();
  const km = keyBySerial(serial) ?? activeKey();
  return toCert(km, km.certSerial === ring.activeSerial);
}

// Every certificate in the keyring (active + retired), newest-relevant metadata only.
export function listDscCertificates(): DscCertificate[] {
  const ring = loadKeyring();
  return ring.keys.map((k) => toCert(k, k.certSerial === ring.activeSerial));
}

// True when the keyring is sourced from env/HSM PEMs (in-app rotation disabled).
export function isEnvManagedDsc(): boolean {
  return !!loadKeyring().envManaged;
}

export interface DscRotationResult {
  rotated: boolean;
  reason?: string;
  previousSerial?: string;
  certificate?: DscCertificate;
}

// Rotate the signing key: generate a fresh RSA-2048 key, make it active, and retain all
// previous keys for verification. No-op when env/HSM-managed (the CA owns rotation).
export function rotateDsc(): DscRotationResult {
  const ring = loadKeyring();
  if (ring.envManaged) {
    return {
      rotated: false,
      reason: "DSC is sourced from environment/HSM PEMs; rotation is handled out-of-band by the Certifying Authority.",
    };
  }
  const previousSerial = ring.activeSerial;
  const next = generateKeyMaterial();
  ring.keys.push(next);
  ring.activeSerial = next.certSerial;
  persist(ring);
  cached = ring;
  return { rotated: true, previousSerial, certificate: toCert(next, true) };
}
