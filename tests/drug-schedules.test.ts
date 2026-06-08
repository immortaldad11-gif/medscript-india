import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { evaluateScheduleRule, detectInteractions } from "@/lib/drug-schedules";
import { prisma } from "@/lib/prisma";

// Drug-safety engine — Section 1.4 / 4.1.2.
//   • evaluateScheduleRule is pure (the telemedicine schedule rules) — always tested.
//   • detectInteractions reads the seeded `drug_interactions` table. Those cases run
//     only when Postgres is reachable AND seeded (npm run prisma:seed); otherwise they
//     skip, so the suite still passes without `docker compose up`.

let dbReady = false;

before(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    // Treat as ready only if the reference data is actually seeded.
    const hasPair = await prisma.drugInteraction.findFirst({
      where: { OR: [{ drugA: "Clopidogrel" }, { drugB: "Clopidogrel" }] },
    });
    dbReady = !!hasPair;
  } catch {
    dbReady = false;
  }
});

after(async () => {
  try {
    await prisma.$disconnect();
  } catch {
    /* allow the test process to exit cleanly */
  }
});

test("Schedule X is blocked from telemedicine and flagged for in-person", () => {
  const r = evaluateScheduleRule("Morphine", "X");
  assert.equal(r.allowed, false);
  assert.equal(r.requiresAddress, true);
  assert.match(r.reason ?? "", /in person|blocked/i);
});

test("Schedule H1 is allowed but requires patient address / stricter records", () => {
  const r = evaluateScheduleRule("Tramadol", "H1");
  assert.equal(r.allowed, true);
  assert.equal(r.requiresAddress, true);
  assert.match(r.reason ?? "", /H1/);
});

test("Schedule H is allowed with no extra address requirement", () => {
  const r = evaluateScheduleRule("Amoxicillin", "H");
  assert.equal(r.allowed, true);
  assert.equal(r.requiresAddress, false);
  assert.equal(r.reason, undefined);
});

test("OTC is allowed with no restriction", () => {
  const r = evaluateScheduleRule("Paracetamol", "OTC");
  assert.equal(r.allowed, true);
  assert.equal(r.requiresAddress, false);
});

test("detectInteractions short-circuits for fewer than two distinct drugs", async () => {
  // No DB needed — the function returns early before any query.
  assert.deepEqual(await detectInteractions(["Warfarin"]), []);
  assert.deepEqual(await detectInteractions(["Warfarin", " warfarin "]), []); // dedup → 1 distinct
  assert.deepEqual(await detectInteractions([]), []);
});

test("detectInteractions flags a known contraindicated pair", async (t) => {
  if (!dbReady) {
    t.skip("requires a seeded Postgres");
    return;
  }
  const found = await detectInteractions(["Clopidogrel", "Warfarin"]);
  assert.equal(found.length, 1);
  assert.equal(found[0].severity, "CONTRAINDICATED");
});

test("detectInteractions is order-independent", async (t) => {
  if (!dbReady) {
    t.skip("requires a seeded Postgres");
    return;
  }
  const ab = await detectInteractions(["Clopidogrel", "Warfarin"]);
  const ba = await detectInteractions(["Warfarin", "Clopidogrel"]);
  assert.equal(ab.length, 1);
  assert.equal(ba.length, 1);
  assert.equal(ab[0].severity, ba[0].severity);
});

test("detectInteractions returns nothing for an unrelated pair", async (t) => {
  if (!dbReady) {
    t.skip("requires a seeded Postgres");
    return;
  }
  assert.deepEqual(await detectInteractions(["Paracetamol", "Cetirizine"]), []);
});

test("detectInteractions covers a newly-seeded pair (Sildenafil + Isosorbide Mononitrate)", async (t) => {
  if (!dbReady) {
    t.skip("requires a seeded Postgres");
    return;
  }
  const found = await detectInteractions(["Sildenafil", "Isosorbide Mononitrate"]);
  assert.equal(found.length, 1);
  assert.equal(found[0].severity, "CONTRAINDICATED");
});
