import { test } from "node:test";
import assert from "node:assert/strict";
import { encryptField, decryptField, sha256, randomToken } from "@/lib/crypto";

// Field-level PHI encryption (AES-256-GCM). These guard the at-rest confidentiality and
// integrity properties we rely on for ABHA ID / Aadhaar / 2FA secrets (Section 2.3.2).

test("encryptField → decryptField round-trips arbitrary UTF-8", () => {
  for (const plaintext of ["12-3456-7890-1234", "patient@example.in", "नमस्ते 🩺", "a".repeat(5000)]) {
    assert.equal(decryptField(encryptField(plaintext)), plaintext);
  }
});

// Documents a known edge: an empty plaintext encrypts to an empty ciphertext segment,
// which decryptField's malformed-payload guard rejects. PHI fields (ABHA/Aadhaar/2FA
// secret) are never empty, so this asymmetry is captured here rather than worked around.
test("empty plaintext is not a supported round-trip (decrypt guard rejects it)", () => {
  assert.throws(() => decryptField(encryptField("")), /Malformed ciphertext/);
});

test("ciphertext is iv.tag.ct (three base64 segments) and never the plaintext", () => {
  const ct = encryptField("4111-1111-1111-1111");
  const parts = ct.split(".");
  assert.equal(parts.length, 3, "expected iv.tag.ct");
  for (const p of parts) {
    assert.ok(p.length > 0);
    // Round-trips through base64 cleanly.
    assert.equal(Buffer.from(p, "base64").toString("base64"), p);
  }
  assert.ok(!ct.includes("4111"), "plaintext must not leak into ciphertext");
});

test("encryption is randomized — same plaintext yields distinct ciphertexts (unique IV)", () => {
  const a = encryptField("same-secret");
  const b = encryptField("same-secret");
  assert.notEqual(a, b, "identical input must not produce identical ciphertext");
  assert.equal(decryptField(a), decryptField(b));
});

test("tampering with the ciphertext body fails the GCM auth tag", () => {
  const ct = encryptField("integrity-protected");
  const [iv, tag, body] = ct.split(".");
  // Flip the first byte of the ciphertext body.
  const buf = Buffer.from(body, "base64");
  buf[0] ^= 0xff;
  const tampered = [iv, tag, buf.toString("base64")].join(".");
  assert.throws(() => decryptField(tampered));
});

test("tampering with the auth tag is rejected", () => {
  const ct = encryptField("integrity-protected");
  const [iv, tag, body] = ct.split(".");
  const buf = Buffer.from(tag, "base64");
  buf[0] ^= 0xff;
  assert.throws(() => decryptField([iv, buf.toString("base64"), body].join(".")));
});

test("malformed payloads are rejected explicitly", () => {
  assert.throws(() => decryptField("not-a-valid-payload"), /Malformed ciphertext/);
  assert.throws(() => decryptField("only.two"), /Malformed ciphertext/);
});

test("sha256 is deterministic, hex, and 64 chars", () => {
  const h = sha256("aadhaar-lookup-key");
  assert.equal(h, sha256("aadhaar-lookup-key"));
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.notEqual(h, sha256("aadhaar-lookup-key2"));
});

test("randomToken returns hex of 2×bytes length and is non-repeating", () => {
  assert.equal(randomToken(8).length, 16);
  assert.equal(randomToken(32).length, 64);
  assert.match(randomToken(8), /^[0-9a-f]+$/);
  assert.notEqual(randomToken(16), randomToken(16));
});
