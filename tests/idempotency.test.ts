import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { POST } from "@/app/api/v1/prescriptions/route";
import { signAccessToken } from "@/lib/jwt";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";

// Idempotency — Section 7.1. Integration test: it invokes the real prescription-create
// handler twice with the same idempotencyKey and asserts the second call is a replay
// (returns the same prescription, no duplicate, create ran exactly once). It cleans up
// the prescription it makes. Runs only when Postgres is reachable.

let dbReady = false;
let token = "";
let doctorId = "";
let patientPhone = "";
const idemKey = `itest-idem-${Date.now()}`;
let createdRxId = "";

before(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const doctor = await prisma.user.findFirst({ where: { role: "DOCTOR" } });
    const patient = await prisma.user.findFirst({ where: { role: "PATIENT" } });
    if (doctor && patient?.phone) {
      doctorId = doctor.id;
      patientPhone = patient.phone;
      token = signAccessToken({ sub: doctor.id, role: "DOCTOR", twoFactor: true });
      dbReady = true;
    }
  } catch {
    dbReady = false;
  }
});

after(async () => {
  try {
    if (createdRxId) await prisma.prescription.delete({ where: { id: createdRxId } }); // cascades meds/interactions
    await prisma.auditLog.deleteMany({
      where: { action: "PRESCRIPTION_CREATED", performedById: doctorId, metadata: { path: ["idempotencyKey"], equals: idemKey } },
    });
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

function makeRequest() {
  const body = JSON.stringify({
    patientPhone,
    patientName: "Idempotency Integration Patient",
    idempotencyKey: idemKey,
    medications: [{ drugName: "Paracetamol", dosage: "500", unit: "mg", frequency: "BD", duration: "3 days" }],
  });
  // The handler only uses Request methods (json(), headers.get) — a plain Request suffices.
  return new Request("http://localhost/api/v1/prescriptions", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body,
  }) as unknown as Parameters<typeof POST>[0];
}

test("the same idempotencyKey returns the same prescription, not a duplicate (Section 7.1)", async (t) => {
  if (!dbReady) return void t.skip("requires a seeded Postgres");

  const res1 = await POST(makeRequest());
  const body1 = await res1.json();
  assert.equal(res1.status, 201, "first call creates the prescription");
  const id1: string = body1.data.id;
  createdRxId = id1;
  assert.ok(id1, "first call returns an id");

  const res2 = await POST(makeRequest());
  const body2 = await res2.json();
  assert.equal(res2.status, 200, "second call is the idempotent replay (200, not a fresh 201)");
  assert.equal(body2.data.id, id1, "second call returns the SAME prescription");

  // The create side-effect (audit log) must have run exactly once.
  const auditCount = await prisma.auditLog.count({
    where: { action: "PRESCRIPTION_CREATED", performedById: doctorId, metadata: { path: ["idempotencyKey"], equals: idemKey } },
  });
  assert.equal(auditCount, 1, "create executed exactly once despite two requests");
});
