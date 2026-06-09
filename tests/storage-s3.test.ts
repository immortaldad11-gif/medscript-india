// Configure the S3 backend BEFORE importing the storage module (the driver reads these
// at construction). Defaults target a local MinIO; CI provides the same via a service.
process.env.STORAGE_DRIVER = "s3";
process.env.S3_ENDPOINT = process.env.S3_ENDPOINT || "http://localhost:9000";
process.env.S3_BUCKET = process.env.S3_BUCKET || "medscript-s3-test";
process.env.S3_REGION = process.env.S3_REGION || "us-east-1";
process.env.S3_FORCE_PATH_STYLE = "1";
process.env.S3_SSE = "none"; // MinIO without a configured KMS
process.env.AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || "minioadmin";
process.env.AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY || "minioadmin";

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { S3Client, CreateBucketCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { putObject, getObject, deleteObject, describeStorage } from "@/lib/storage";

// Validates the production S3 storage path against a real S3 API (MinoIO / LocalStack /
// AWS). Proves the bytes are app-encrypted at rest and survive a put/get/delete cycle.
// Skips gracefully when no S3 endpoint is reachable, so `npm test` still runs locally.

const BUCKET = process.env.S3_BUCKET!;
const KEY = `__tests__/s3-probe-${Date.now()}`;
let s3: S3Client;
let s3Ready = false;

before(async () => {
  s3 = new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
  });
  try {
    await s3.send(new CreateBucketCommand({ Bucket: BUCKET })).catch((e: { name?: string }) => {
      if (!/BucketAlreadyOwnedByYou|BucketAlreadyExists/.test(e?.name ?? "")) throw e;
    });
    s3Ready = true;
  } catch {
    s3Ready = false;
  }
});

after(async () => {
  if (s3 && s3Ready) {
    try {
      await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: `${KEY}.enc` }));
    } catch {
      /* best-effort cleanup */
    }
  }
  s3?.destroy();
});

test("putObject/getObject round-trip binary data through the S3 backend", async (t) => {
  if (!s3Ready) return void t.skip("requires an S3-compatible store (MinIO) at S3_ENDPOINT");
  const data = crypto.randomBytes(256);
  await putObject(KEY, data);
  const got = await getObject(KEY);
  assert.deepEqual(got, data);
});

test("the object stored in S3 is app-encrypted ciphertext, not plaintext", async (t) => {
  if (!s3Ready) return void t.skip("requires MinIO");
  // The driver stores under `<key>.enc`; read the raw object straight from the bucket.
  const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: `${KEY}.enc` }));
  const raw = await res.Body!.transformToString("utf8");
  // encryptField output is base64(iv).base64(tag).base64(ct) — three dot-separated parts.
  assert.equal(raw.split(".").length, 3, "at-rest blob has the iv.tag.ct shape");
});

test("describeStorage reports the S3 backend", async (t) => {
  if (!s3Ready) return void t.skip("requires MinIO");
  const d = describeStorage();
  assert.match(d, /^s3:\/\//);
  assert.match(d, /endpoint=/);
});

test("deleteObject removes the object from S3", async (t) => {
  if (!s3Ready) return void t.skip("requires MinIO");
  await deleteObject(KEY);
  await assert.rejects(() => getObject(KEY)); // NoSuchKey
});
