/**
 * Storage migration: local disk -> S3 (Section 4.3 document storage).
 *
 * Moves the encrypted document blobs that accumulated under storage/<patientId>/<reportId>.enc
 * while STORAGE_DRIVER=local into the configured S3 bucket, so the app can be cut over to
 * STORAGE_DRIVER=s3 without losing existing reports.
 *
 * IMPORTANT — the on-disk files are ALREADY app-encrypted ciphertext (AES-256-GCM, the
 * `iv.tag.ct` envelope produced by encryptField). We therefore copy the raw ciphertext byte
 * for byte via the low-level driver get/put. We deliberately do NOT route through
 * putObject/getObject (the public API), which would re-encrypt and yield ciphertext the app
 * can never decrypt. S3 server-side encryption (SSE) is layered on top of this at-rest
 * ciphertext by the S3 driver, exactly as for freshly uploaded objects.
 *
 * Usage:
 *   # 1. Configure S3 in the environment (S3_BUCKET, S3_REGION, credentials, optional
 *   #    S3_ENDPOINT/S3_PREFIX/S3_SSE). STORAGE_DRIVER itself is irrelevant here — the
 *   #    script always reads from the local driver and writes to the s3 driver explicitly.
 *   # 2. Dry run (default) — lists what WOULD be copied, touches nothing:
 *   npm run storage:migrate
 *   # 3. Apply — copies + verifies each object (re-reads from S3 and compares ciphertext):
 *   npm run storage:migrate -- --apply
 *   # 4. Apply and reclaim disk — deletes each local file only AFTER its S3 copy verifies:
 *   npm run storage:migrate -- --apply --delete-local
 */
import { prisma } from "@/lib/prisma";
import { createDriver, listLocalStorageKeys, describeStorage } from "@/lib/storage";

interface Args {
  apply: boolean;
  deleteLocal: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const set = new Set(argv);
  return {
    apply: set.has("--apply"),
    deleteLocal: set.has("--delete-local"),
    help: set.has("--help") || set.has("-h"),
  };
}

const HELP = `Migrate encrypted document blobs from local disk to S3.

Options:
  --apply          Perform the copy (default is a dry run that changes nothing).
  --delete-local   After an object's S3 copy is verified, delete the local file.
                   Ignored without --apply.
  -h, --help       Show this help.

S3 is configured via the same env vars the app uses: S3_BUCKET (required), S3_REGION,
S3_ENDPOINT, S3_PREFIX, S3_SSE, S3_KMS_KEY_ID, plus the standard AWS credential chain.`;

// Try to read an object; return null when it does not exist yet (so re-runs are idempotent).
async function tryGet(driver: ReturnType<typeof createDriver>, key: string): Promise<string | null> {
  try {
    return await driver.get(key);
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    return;
  }

  const local = createDriver("local");
  // Constructing the S3 driver validates required S3_* env up front (throws if S3_BUCKET unset).
  const s3 = createDriver("s3");

  console.log(`Source: ${local.describe()}`);
  console.log(`Target: ${s3.describe()}`);
  console.log(`Mode:   ${args.apply ? (args.deleteLocal ? "APPLY + delete-local" : "APPLY") : "DRY RUN (no changes)"}`);
  console.log("");

  const keys = await listLocalStorageKeys();
  if (keys.length === 0) {
    console.log("No local .enc objects found under storage/. Nothing to migrate.");
    return;
  }

  // Cross-reference the DB so we can flag orphans (disk blobs with no MedicalReport row) and
  // missing files (rows whose s3Key has no blob on disk). Neither is fatal — purely advisory.
  const reports = await prisma.medicalReport.findMany({ select: { s3Key: true } });
  const dbKeys = new Set(reports.map((r) => r.s3Key));
  const diskKeys = new Set(keys);

  const orphans = keys.filter((k) => !dbKeys.has(k));
  const missingOnDisk = [...dbKeys].filter((k) => !diskKeys.has(k));
  if (orphans.length > 0) {
    console.log(`! ${orphans.length} on-disk blob(s) have no MedicalReport row (migrating anyway):`);
    for (const k of orphans) console.log(`    orphan: ${k}`);
  }
  if (missingOnDisk.length > 0) {
    console.log(`! ${missingOnDisk.length} MedicalReport row(s) reference a blob not present on disk:`);
    for (const k of missingOnDisk) console.log(`    missing: ${k}`);
  }
  if (orphans.length > 0 || missingOnDisk.length > 0) console.log("");

  let copied = 0;
  let skipped = 0;
  let deleted = 0;
  let failed = 0;

  for (const key of keys) {
    const ciphertext = await local.get(key);
    const bytes = Buffer.byteLength(ciphertext, "utf8");

    if (!args.apply) {
      const existing = await tryGet(s3, key);
      const note = existing === null ? "would copy" : existing === ciphertext ? "already present (identical)" : "would OVERWRITE (differs)";
      console.log(`  [dry-run] ${key}  (${bytes} B) — ${note}`);
      continue;
    }

    try {
      const existing = await tryGet(s3, key);
      if (existing === ciphertext) {
        console.log(`  = skip   ${key}  (${bytes} B) — already in S3, identical`);
        skipped++;
      } else {
        await s3.put(key, ciphertext);
        // Verify the round-trip: re-read from S3 and require byte-identical ciphertext before
        // we trust the copy (and certainly before deleting the local original).
        const roundtrip = await s3.get(key);
        if (roundtrip !== ciphertext) {
          throw new Error(`verification mismatch (wrote ${bytes} B, read back ${Buffer.byteLength(roundtrip, "utf8")} B)`);
        }
        console.log(`  + copy   ${key}  (${bytes} B) — verified`);
        copied++;
      }

      if (args.deleteLocal) {
        await local.del(key);
        deleted++;
      }
    } catch (err) {
      failed++;
      console.error(`  x FAIL   ${key} — ${(err as Error).message}`);
    }
  }

  console.log("");
  console.log(
    args.apply
      ? `Done. copied=${copied} skipped=${skipped} deleted=${deleted} failed=${failed} (of ${keys.length} blobs).`
      : `Dry run complete. ${keys.length} blob(s) would be processed. Re-run with --apply to migrate.`,
  );

  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error("Migration aborted:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
