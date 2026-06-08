import test from "node:test";
import assert from "node:assert/strict";
import { parseVoicePrescription } from "@/lib/voice-rx";

// Voice-to-prescription parser — Section 4.2. Pure function (transcript + reference
// drug names → structured orders), so these tests need no DB/Redis. They pin the
// extraction rules and, crucially, guard the comma-split fix against regression.

const KNOWN = ["Azithromycin", "Pantoprazole", "Levocetirizine", "Cetirizine", "Amoxicillin", "Paracetamol", "Morphine"];

test("REGRESSION: comma-separated drugs each parse as their own order", () => {
  // Without the comma split, "Azithromycin ... 3 days, Pantoprazole ... 5 days"
  // collapsed into one clause and the second drug (plus its dose) was lost.
  const res = parseVoicePrescription(
    "Patient complains of fever and cough. Diagnosis acute bronchitis. Start Azithromycin 500 mg once daily for 3 days, Pantoprazole 40 mg once daily before food for 5 days, and Levocetirizine 5 mg at night for 7 days.",
    KNOWN,
  );

  assert.equal(res.chiefComplaint, "fever and cough");
  assert.equal(res.diagnosisText, "acute bronchitis");
  assert.equal(res.unmatchedSegments.length, 0);
  assert.deepEqual(
    res.medications,
    [
      { drugName: "Azithromycin", dosage: "500", unit: "mg", frequency: "OD", duration: "3 days", instructions: "", matchedDrug: true },
      { drugName: "Pantoprazole", dosage: "40", unit: "mg", frequency: "OD", duration: "5 days", instructions: "before food", matchedDrug: true },
      { drugName: "Levocetirizine", dosage: "5", unit: "mg", frequency: "HS", duration: "7 days", instructions: "", matchedDrug: true },
    ],
  );
});

test("frequency phrases map to standard codes", () => {
  const cases: Array<[string, string]> = [
    ["Paracetamol 500 mg once daily for 3 days", "OD"],
    ["Paracetamol 500 mg twice daily for 3 days", "BD"],
    ["Paracetamol 500 mg three times daily for 3 days", "TDS"],
    ["Paracetamol 500 mg four times a day for 3 days", "QID"],
    ["Paracetamol 500 mg at night for 3 days", "HS"],
    ["Paracetamol 500 mg if needed for 3 days", "SOS"],
    ["Paracetamol 500 mg stat", "STAT"],
  ];
  for (const [text, code] of cases) {
    const m = parseVoicePrescription(text, ["Paracetamol"]).medications[0];
    assert.equal(m?.frequency, code, `"${text}" → ${code}`);
  }
});

test("dose, unit and word-number quantities are extracted", () => {
  const a = parseVoicePrescription("Amoxicillin 500 mg twice daily for 5 days", ["Amoxicillin"]).medications[0];
  assert.equal(a.dosage, "500");
  assert.equal(a.unit, "mg");

  const b = parseVoicePrescription("Give Amoxicillin two tablets twice daily for one week", ["Amoxicillin"]).medications[0];
  assert.equal(b.dosage, "2");
  assert.equal(b.unit, "tab");
  assert.equal(b.duration, "1 weeks");
});

test("durations in days and weeks", () => {
  assert.equal(parseVoicePrescription("Paracetamol 500 mg od for 7 days", ["Paracetamol"]).medications[0].duration, "7 days");
  assert.equal(parseVoicePrescription("Paracetamol 500 mg od for 2 weeks", ["Paracetamol"]).medications[0].duration, "2 weeks");
});

test("trailing instructions are captured", () => {
  assert.equal(
    parseVoicePrescription("Paracetamol 500 mg bd for 3 days after food", ["Paracetamol"]).medications[0].instructions,
    "after food",
  );
});

test("known drugs match by longest name (Levocetirizine, not Cetirizine)", () => {
  const m = parseVoicePrescription("Continue Levocetirizine 5 mg at night for 7 days", ["Cetirizine", "Levocetirizine"]).medications[0];
  assert.equal(m.drugName, "Levocetirizine");
  assert.equal(m.matchedDrug, true);
});

test("an unknown drug is surfaced with matchedDrug=false (never silently dropped)", () => {
  const res = parseVoicePrescription("Start Xyzdrug 250 mg twice daily for 5 days", KNOWN);
  assert.equal(res.medications.length, 1);
  assert.equal(res.medications[0].drugName, "Xyzdrug");
  assert.equal(res.medications[0].matchedDrug, false);
});

test("a dose/frequency clause with no drug goes to unmatchedSegments", () => {
  const res = parseVoicePrescription("Give 500 mg twice daily", KNOWN);
  assert.equal(res.medications.length, 0);
  assert.equal(res.unmatchedSegments.length, 1);
});

test("the same drug dictated twice is de-duplicated", () => {
  const res = parseVoicePrescription(
    "Start Amoxicillin 500 mg twice daily for 5 days, Amoxicillin 250 mg once daily for 3 days",
    ["Amoxicillin"],
  );
  assert.equal(res.medications.length, 1);
  assert.equal(res.medications[0].drugName, "Amoxicillin");
});

test("the parser is content-neutral — it extracts a Schedule X drug (the block is enforced at create-time)", () => {
  const m = parseVoicePrescription("Start Morphine 10 mg once daily for 3 days", KNOWN).medications[0];
  assert.equal(m.drugName, "Morphine");
  assert.equal(m.matchedDrug, true);
});
