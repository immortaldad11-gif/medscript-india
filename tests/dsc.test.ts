import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import {
  signWithDsc,
  verifyDscSignature,
  rotateDsc,
  listDscCertificates,
  getDscCertificate,
  isEnvManagedDsc,
} from "@/lib/dsc";

// DSC sign/verify/rotation (Section 5.1, IT Act 2000 §3). The rotation test mutates the
// on-disk keyring (storage/.dsc/platform-dsc.json), so we snapshot it before the suite and
// restore it after — the dev environment's signing keyring is left exactly as we found it.
const KEY_FILE = path.join(process.cwd(), "storage", ".dsc", "platform-dsc.json");
let snapshot: string | null = null;

before(() => {
  snapshot = fs.existsSync(KEY_FILE) ? fs.readFileSync(KEY_FILE, "utf8") : null;
});
after(() => {
  if (snapshot !== null) fs.writeFileSync(KEY_FILE, snapshot, { mode: 0o600 });
});

const CANON = JSON.stringify({ id: "rx_1", patient: "Asha Verma", at: "2026-06-06" });

test("sign produces a base64 RSA-SHA256 signature that verifies under its own serial", () => {
  const sig = signWithDsc(CANON);
  assert.equal(sig.algorithm, "RSA-SHA256");
  assert.match(sig.certSerial, /^[0-9A-F]{16}$/);
  assert.equal(Buffer.from(sig.signatureValue, "base64").toString("base64"), sig.signatureValue);
  assert.equal(verifyDscSignature(CANON, sig.signatureValue, sig.certSerial), true);
});

test("verification rejects a different payload and a tampered signature", () => {
  const sig = signWithDsc(CANON);
  assert.equal(verifyDscSignature(CANON + "x", sig.signatureValue, sig.certSerial), false);

  const buf = Buffer.from(sig.signatureValue, "base64");
  buf[0] ^= 0xff;
  assert.equal(verifyDscSignature(CANON, buf.toString("base64"), sig.certSerial), false);
  assert.equal(verifyDscSignature(CANON, "not-base64-signature", sig.certSerial), false);
});

test("an omitted serial falls back to best-effort verification across the keyring", () => {
  const sig = signWithDsc(CANON);
  assert.equal(verifyDscSignature(CANON, sig.signatureValue), true);
  assert.equal(verifyDscSignature(CANON, sig.signatureValue, null), true);
});

test("rotation retains older signatures and pins verification to the signing serial", () => {
  // Signature made under the pre-rotation active key.
  const before = signWithDsc(CANON);
  const oldSerial = before.certSerial;

  const result = rotateDsc();
  assert.equal(result.rotated, true);
  assert.equal(result.previousSerial, oldSerial);
  assert.ok(result.certificate);
  const newSerial = result.certificate!.serial;
  assert.notEqual(newSerial, oldSerial);
  assert.equal(result.certificate!.active, true);

  // Signature made under the post-rotation active key.
  const after = signWithDsc(CANON);
  assert.equal(after.certSerial, newSerial);

  // Old signature still verifies under its own serial (renewed-cert behavior)...
  assert.equal(verifyDscSignature(CANON, before.signatureValue, oldSerial), true);
  // ...but NOT when pinned to the new serial — by-serial selection is exact.
  assert.equal(verifyDscSignature(CANON, before.signatureValue, newSerial), false);
  // New signature verifies under the new serial, not the old.
  assert.equal(verifyDscSignature(CANON, after.signatureValue, newSerial), true);
  assert.equal(verifyDscSignature(CANON, after.signatureValue, oldSerial), false);

  // The keyring now exposes both certs, with exactly one marked active (the new one).
  const certs = listDscCertificates();
  assert.ok(certs.length >= 2);
  const active = certs.filter((c) => c.active);
  assert.equal(active.length, 1);
  assert.equal(active[0].serial, newSerial);

  // Per-serial metadata: the retired cert reports itself as inactive; default returns active.
  assert.equal(getDscCertificate(oldSerial).active, false);
  assert.equal(getDscCertificate(oldSerial).serial, oldSerial);
  assert.equal(getDscCertificate().serial, newSerial);
  assert.equal(getDscCertificate().active, true);
});

test("the on-disk dev keyring is not env/HSM-managed (in-app rotation enabled)", () => {
  assert.equal(isEnvManagedDsc(), false);
});
