import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import {
  signWithDsc,
  verifyDscSignature,
  rotateDsc,
  listDscCertificates,
  getDscCertificate,
  isEnvManagedDsc,
} from "@/lib/dsc";

// Env/HSM-managed DSC branch (production path): when the signing key is sourced from
// DSC_*_PEM env vars (an HSM export), in-app rotation is disabled because the Certifying
// Authority owns the certificate lifecycle. node --test runs each file in its own process,
// so setting these env vars here cannot leak into dsc.test.ts's on-disk-keyring assertions.
//
// loadKeyring() reads the env lazily on first call, so setting it at module top — before any
// test callback runs — is sufficient; it never touches storage/.dsc/.
const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
process.env.DSC_PRIVATE_KEY_PEM = Buffer.from(privateKey).toString("base64");
process.env.DSC_PUBLIC_KEY_PEM = Buffer.from(publicKey).toString("base64");
process.env.DSC_CERT_SERIAL = "ENVTESTSERIAL001";

const CANON = JSON.stringify({ id: "rx_env", patient: "Asha Verma" });

test("env-sourced keyring is flagged as env/HSM-managed", () => {
  assert.equal(isEnvManagedDsc(), true);
});

test("signing uses the env serial and verifies", () => {
  const sig = signWithDsc(CANON);
  assert.equal(sig.certSerial, "ENVTESTSERIAL001");
  assert.equal(verifyDscSignature(CANON, sig.signatureValue, sig.certSerial), true);
  assert.equal(verifyDscSignature(CANON + "x", sig.signatureValue, sig.certSerial), false);
});

test("rotation is a no-op under env/HSM management (CA owns the lifecycle)", () => {
  const result = rotateDsc();
  assert.equal(result.rotated, false);
  assert.match(result.reason ?? "", /Certifying Authority|out-of-band|HSM/i);
});

test("only the single env certificate is listed, and it is active", () => {
  const certs = listDscCertificates();
  assert.equal(certs.length, 1);
  assert.equal(certs[0].serial, "ENVTESTSERIAL001");
  assert.equal(certs[0].active, true);
  assert.equal(getDscCertificate().serial, "ENVTESTSERIAL001");
});
