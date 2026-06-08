import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { resolveActiveConsent } from "@/lib/consent";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";

// Consent framework — Section 4.3.3 (automatic expiry). Integration test: it creates
// real ConsentArtefact rows (against the seeded users) and cleans them up. Runs only
// when Postgres is reachable; skips gracefully otherwise.

let dbReady = false;
let patientId = "";
let granteeId = "";
const created: string[] = [];

before(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const patient = await prisma.user.findFirst({ where: { role: "PATIENT" } });
    const grantee = await prisma.user.findFirst({ where: { role: "DOCTOR" } });
    if (patient && grantee) {
      patientId = patient.id;
      granteeId = grantee.id;
      dbReady = true;
    }
  } catch {
    dbReady = false;
  }
});

after(async () => {
  try {
    if (created.length) await prisma.consentArtefact.deleteMany({ where: { id: { in: created } } });
  } catch {
    /* best-effort cleanup */
  }
  try {
    await prisma.$disconnect();
  } catch {
    /* ignore */
  }
  if (redis) {
    try {
      await redis.quit();
    } catch {
      /* let the process exit */
    }
  }
});

async function makeConsent(expiresAt: Date, status: "ACTIVE" | "REVOKED" = "ACTIVE") {
  const c = await prisma.consentArtefact.create({
    data: { patientId, granteeId, granteeType: "DOCTOR", purpose: "integration-test", expiresAt, status },
  });
  created.push(c.id);
  return c;
}

test("an active, unexpired consent resolves for its grantee", async (t) => {
  if (!dbReady) return void t.skip("requires a seeded Postgres");
  const c = await makeConsent(new Date(Date.now() + 3_600_000));
  const resolved = await resolveActiveConsent(c.id, granteeId);
  assert.ok(resolved, "should resolve");
  assert.equal(resolved!.id, c.id);
});

test("an expired consent resolves to null AND is lazily flipped to EXPIRED (4.3.3)", async (t) => {
  if (!dbReady) return void t.skip("requires a seeded Postgres");
  const c = await makeConsent(new Date(Date.now() - 1_000)); // already past
  assert.equal(c.status, "ACTIVE", "starts ACTIVE");

  const resolved = await resolveActiveConsent(c.id, granteeId);
  assert.equal(resolved, null, "expired consent must not resolve");

  const reloaded = await prisma.consentArtefact.findUnique({ where: { id: c.id } });
  assert.equal(reloaded!.status, "EXPIRED", "auto-expiry must flip the status");
});

test("a consent does not resolve for a different grantee", async (t) => {
  if (!dbReady) return void t.skip("requires a seeded Postgres");
  const c = await makeConsent(new Date(Date.now() + 3_600_000));
  const resolved = await resolveActiveConsent(c.id, patientId); // not the grantee
  assert.equal(resolved, null);
});

test("a revoked consent does not resolve even before its expiry", async (t) => {
  if (!dbReady) return void t.skip("requires a seeded Postgres");
  const c = await makeConsent(new Date(Date.now() + 3_600_000), "REVOKED");
  const resolved = await resolveActiveConsent(c.id, granteeId);
  assert.equal(resolved, null);
});
