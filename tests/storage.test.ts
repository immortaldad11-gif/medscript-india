// Force the local disk driver for this process before the storage module memoizes its
// driver — keeps these assertions deterministic no matter what STORAGE_DRIVER the app/.env
// is configured with. node --test isolates each file in its own process, so this is safe.
process.env.STORAGE_DRIVER = "local";

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import {
  putObject,
  getObject,
  deleteObject,
  createDriver,
  listLocalStorageKeys,
  signDownloadUrl,
  verifyDownloadSignature,
} from "@/lib/storage";

const ROOT = path.join(process.cwd(), "storage");
const NS = "__tests__";
const key = (name: string) => `${NS}/${crypto.randomUUID()}-${name}`;

after(() => {
  fs.rmSync(path.join(ROOT, NS), { recursive: true, force: true });
});

test("putObject → getObject round-trips raw bytes through encrypt-at-rest", async () => {
  const k = key("roundtrip");
  const data = crypto.randomBytes(2048);
  await putObject(k, data);
  const out = await getObject(k);
  assert.ok(out.equals(data), "decrypted bytes must equal the original");
  await deleteObject(k);
});

test("the at-rest blob is app-encrypted ciphertext, not the plaintext", async () => {
  const k = key("atrest");
  const secret = Buffer.from("CONFIDENTIAL-LAB-RESULT-PAYLOAD", "utf8");
  await putObject(k, secret);

  // Read the blob exactly as it sits on disk, bypassing the decrypt wrapper.
  const raw = await createDriver("local").get(k);
  assert.equal(raw.split(".").length, 3, "expected iv.tag.ct ciphertext envelope");
  assert.ok(!raw.includes("CONFIDENTIAL"), "plaintext must not appear in the stored blob");

  // And the .enc file physically exists under storage/.
  assert.ok(fs.existsSync(path.join(ROOT, k + ".enc")));
  await deleteObject(k);
});

test("migration invariant: copying the raw ciphertext blob (no re-encryption) preserves the object", async () => {
  // This is exactly what migrate-storage-to-s3 does: a low-level driver.get → driver.put of
  // the already-encrypted blob, NOT putObject/getObject (which would double-encrypt).
  const src = key("mig-src");
  const dest = key("mig-dest");
  const data = crypto.randomBytes(4096);
  await putObject(src, data);

  const local = createDriver("local");
  const blob = await local.get(src); // the at-rest ciphertext
  await local.put(dest, blob); // byte-for-byte copy

  // The copied blob is identical at rest...
  assert.equal(await local.get(dest), blob, "ciphertext must be copied verbatim");
  // ...and decrypts back to the original through the normal read path (no double-encryption).
  assert.ok((await getObject(dest)).equals(data));

  await deleteObject(src);
  await deleteObject(dest);
});

test("listLocalStorageKeys enumerates document blobs and excludes the DSC keyring", async () => {
  const k = key("listed");
  await putObject(k, Buffer.from("x"));
  const keys = await listLocalStorageKeys();
  assert.ok(keys.includes(k), "newly written key should be discoverable");
  assert.ok(!keys.some((s) => s === ".dsc" || s.startsWith(".dsc/")), "signing keyring must be excluded");
  await deleteObject(k);
});

test("signed download URL verifies, and rejects tampering / expiry / wrong id", () => {
  const reportId = "rep_42";
  const url = signDownloadUrl(reportId);
  const q = new URL(url, "http://x").searchParams;
  const exp = q.get("exp");
  const sig = q.get("sig");

  assert.ok(url.startsWith(`/api/v1/documents/${reportId}/download?`));
  assert.equal(verifyDownloadSignature(reportId, exp, sig), true);

  // Tampered signature.
  assert.equal(verifyDownloadSignature(reportId, exp, (sig ?? "").replace(/.$/, "0")), false);
  // Wrong report id — signature is bound to the id.
  assert.equal(verifyDownloadSignature("rep_99", exp, sig), false);
  // Missing components.
  assert.equal(verifyDownloadSignature(reportId, null, sig), false);
  assert.equal(verifyDownloadSignature(reportId, exp, null), false);

  // Already-expired capability (negative TTL puts exp in the past).
  const expiredUrl = signDownloadUrl(reportId, -60);
  const eq = new URL(expiredUrl, "http://x").searchParams;
  assert.equal(verifyDownloadSignature(reportId, eq.get("exp"), eq.get("sig")), false);
});
