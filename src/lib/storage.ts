import { promises as fs, type Dirent } from "fs";
import path from "path";
import crypto from "crypto";
import type { S3Client, ServerSideEncryption } from "@aws-sdk/client-s3";
import { encryptField, decryptField } from "@/lib/crypto";

// Document storage — Section 4.3 Privacy Design Principle.
// Two interchangeable backends selected by STORAGE_DRIVER:
//   - "local" (default): encrypted files on local disk under storage/<patientId>/.
//   - "s3": AWS S3 (or any S3-compatible store via S3_ENDPOINT) with SSE.
// Either way the bytes are ALWAYS app-encrypted at rest (AES-256-GCM via the field
// cipher) before they touch the backend, so the same KMS-managed key path is exercised
// end to end and an S3 object leak still yields only ciphertext. Files are NEVER served
// directly — only via time-scoped signed capability URLs (the dev analog of, and in S3
// mode a deliberate stand-in for, S3 presigned URLs: downloads still flow through our
// API so access control, decryption, and audit stay server-side).

const ROOT = path.join(process.cwd(), "storage");
const URL_SECRET = process.env.JWT_ACCESS_SECRET ?? "dev-access-secret-change-me";

// A backend persists/retrieves an opaque ciphertext blob keyed by a logical storage key
// ("<patientId>/<reportId>"). App-layer encryption lives in the wrappers below so every
// driver stores identical ciphertext and the contract (Buffer in / Buffer out) is stable.
interface StorageDriver {
  put(storageKey: string, ciphertext: string): Promise<void>;
  get(storageKey: string): Promise<string>;
  del(storageKey: string): Promise<void>;
  describe(): string;
}

// --- Local disk driver ---------------------------------------------------------------

function createLocalDriver(): StorageDriver {
  const keyPath = (storageKey: string): string => {
    const resolved = path.resolve(ROOT, storageKey + ".enc");
    if (!resolved.startsWith(ROOT + path.sep)) throw new Error("Invalid storage key");
    return resolved;
  };
  return {
    async put(storageKey, ciphertext) {
      const dest = keyPath(storageKey);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, ciphertext, "utf8");
    },
    async get(storageKey) {
      return fs.readFile(keyPath(storageKey), "utf8");
    },
    async del(storageKey) {
      await fs.rm(keyPath(storageKey), { force: true });
    },
    describe() {
      return `local:${ROOT}`;
    },
  };
}

// --- S3 driver -----------------------------------------------------------------------

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required when STORAGE_DRIVER=s3`);
  return v;
}

function createS3Driver(): StorageDriver {
  const bucket = requiredEnv("S3_BUCKET");
  const region = process.env.S3_REGION ?? process.env.AWS_REGION ?? "ap-south-1";
  const endpoint = process.env.S3_ENDPOINT || undefined; // set for MinIO / LocalStack
  const forcePathStyle = process.env.S3_FORCE_PATH_STYLE === "1" || !!endpoint;
  const prefix = process.env.S3_PREFIX ?? "";
  // SSE-S3 ("AES256") by default; "aws:kms" with S3_KMS_KEY_ID for CMK; "none" to skip
  // (e.g. an S3-compatible store without server-side encryption configured).
  const sseRaw = (process.env.S3_SSE ?? "AES256").toLowerCase();
  const sse: ServerSideEncryption | null =
    sseRaw === "none" ? null : sseRaw === "aws:kms" ? "aws:kms" : "AES256";
  const kmsKeyId = process.env.S3_KMS_KEY_ID || undefined;

  // Lazy-load the SDK so the dependency is only touched in S3 mode.
  let mod: typeof import("@aws-sdk/client-s3") | null = null;
  let client: S3Client | null = null;
  async function connect(): Promise<{ mod: typeof import("@aws-sdk/client-s3"); client: S3Client }> {
    if (!mod || !client) {
      mod = await import("@aws-sdk/client-s3");
      client = new mod.S3Client({ region, endpoint, forcePathStyle });
    }
    return { mod, client };
  }

  const objectKey = (storageKey: string): string => {
    if (storageKey.includes("..")) throw new Error("Invalid storage key");
    return `${prefix}${storageKey}.enc`;
  };

  return {
    async put(storageKey, ciphertext) {
      const { mod, client } = await connect();
      await client.send(
        new mod.PutObjectCommand({
          Bucket: bucket,
          Key: objectKey(storageKey),
          Body: ciphertext,
          ContentType: "application/octet-stream",
          ...(sse ? { ServerSideEncryption: sse } : {}),
          ...(sse === "aws:kms" && kmsKeyId ? { SSEKMSKeyId: kmsKeyId } : {}),
        }),
      );
    },
    async get(storageKey) {
      const { mod, client } = await connect();
      const res = await client.send(new mod.GetObjectCommand({ Bucket: bucket, Key: objectKey(storageKey) }));
      if (!res.Body) throw new Error("Empty S3 object body");
      return res.Body.transformToString("utf8");
    },
    async del(storageKey) {
      const { mod, client } = await connect();
      await client.send(new mod.DeleteObjectCommand({ Bucket: bucket, Key: objectKey(storageKey) }));
    },
    describe() {
      return `s3://${bucket}/${prefix} (region=${region}, sse=${sse ?? "none"}${endpoint ? `, endpoint=${endpoint}` : ""})`;
    },
  };
}

// --- Driver selection ----------------------------------------------------------------

// Construct a fresh (non-memoized) driver by name. Exposed so out-of-band tooling — e.g.
// the storage migration script — can hold a "local" and an "s3" driver simultaneously,
// independent of the STORAGE_DRIVER the app process is configured with.
export function createDriver(which: string): StorageDriver {
  return which.toLowerCase() === "s3" ? createS3Driver() : createLocalDriver();
}

let _driver: StorageDriver | null = null;
function driver(): StorageDriver {
  if (_driver) return _driver;
  _driver = createDriver(process.env.STORAGE_DRIVER ?? "local");
  return _driver;
}

// Enumerate the logical storage keys currently materialized on local disk (the inverse of
// keyPath: strip ROOT and the .enc suffix). The DSC keyring under storage/.dsc/ is NOT a
// document object and is excluded. Used by the migration tool to discover what to copy.
export async function listLocalStorageKeys(): Promise<string[]> {
  const keys: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return; // no storage/ yet
      throw err;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (full === path.join(ROOT, ".dsc")) continue; // signing keyring, not a document
        await walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".enc")) {
        const rel = path.relative(ROOT, full);
        keys.push(rel.slice(0, -".enc".length));
      }
    }
  }
  await walk(ROOT);
  return keys;
}

// Human-readable description of the active backend (diagnostics / health checks).
export function describeStorage(): string {
  return driver().describe();
}

// --- Public object API (backend-agnostic, app-encrypted at rest) ---------------------

// Encrypt bytes at rest, then hand the ciphertext to the active backend.
export async function putObject(storageKey: string, data: Buffer): Promise<void> {
  const ciphertext = encryptField(data.toString("base64"));
  await driver().put(storageKey, ciphertext);
}

export async function getObject(storageKey: string): Promise<Buffer> {
  const ciphertext = await driver().get(storageKey);
  return Buffer.from(decryptField(ciphertext), "base64");
}

export async function deleteObject(storageKey: string): Promise<void> {
  await driver().del(storageKey);
}

// --- Presigned URL pattern (stateless, time-limited capability) ----------------------
// Backend-agnostic: downloads always flow through our API route (which fetches from the
// active backend, decrypts, enforces access control, and audits), so the same signed URL
// works whether bytes live on disk or in S3.

export function signDownloadUrl(reportId: string, ttlSeconds = 15 * 60): string {
  const exp = Date.now() + ttlSeconds * 1000;
  const sig = crypto.createHmac("sha256", URL_SECRET).update(`${reportId}.${exp}`).digest("hex");
  return `/api/v1/documents/${reportId}/download?exp=${exp}&sig=${sig}`;
}

export function verifyDownloadSignature(reportId: string, exp: string | null, sig: string | null): boolean {
  if (!exp || !sig) return false;
  const expNum = Number(exp);
  if (!Number.isFinite(expNum) || expNum < Date.now()) return false;
  const expected = crypto.createHmac("sha256", URL_SECRET).update(`${reportId}.${expNum}`).digest("hex");
  // Constant-time comparison.
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
