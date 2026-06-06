// Voice-to-prescription parser — Section 4.2 (voice dictation).
// Production: cloud STT (Google Speech-to-Text / Whisper) for the audio, then a
// clinical NLP model (ClinicalBERT / MedCAT) to extract structured medication orders.
// Phase 1 ships a deterministic rule-based parser over the dictated transcript: the
// browser captures speech via the Web Speech API and POSTs the text here. It extracts
// medications (drug, dose, unit, frequency, duration, instructions) plus chief complaint
// and diagnosis. The doctor ALWAYS reviews and edits the result before signing — voice
// never auto-submits.

export interface ParsedMedication {
  drugName: string;
  dosage: string;
  unit: string;
  frequency: string;
  duration: string;
  instructions: string;
  matchedDrug: boolean; // true when drugName matched the reference list
}

export interface ParsedPrescription {
  chiefComplaint?: string;
  diagnosisText?: string;
  medications: ParsedMedication[];
  unmatchedSegments: string[]; // clauses we couldn't confidently parse, for doctor review
}

// Spoken frequency phrases → standard codes used by the form.
// Order matters: more specific / higher-frequency phrases are tested first so that
// e.g. "three times daily" isn't shadowed by a looser pattern.
const FREQUENCY_MAP: Array<[RegExp, string]> = [
  [/\b(stat|immediately|at once)\b/, "STAT"],
  [/\b(sos|if needed|as needed|when required)\b/, "SOS"],
  [/\b(four times (a |per )?(day|daily)|q\.?i\.?d\.?|q6h|every six hours)\b/, "QID"],
  [/\b(thrice (a |per )?(day|daily)|three times (a |per )?(day|daily)|t\.?d\.?s\.?|t\.?i\.?d\.?)\b/, "TDS"],
  [/\b(twice (a |per )?(day|daily)|two times (a |per )?(day|daily)|b\.?d\.?|b\.?i\.?d\.?)\b/, "BD"],
  [/\b(once (a |per )?(day|daily)|o\.?d\.?|every morning|mane)\b/, "OD"],
  [/\b(at night|at bedtime|bedtime|nightly|h\.?s\.?|nocte)\b/, "HS"],
];

// Spoken units → canonical units.
const UNIT_MAP: Array<[RegExp, string]> = [
  [/\b(milligrams?|mgs?|mg)\b/, "mg"],
  [/\b(millilitres?|milliliters?|mls?|ml)\b/, "ml"],
  [/\b(micrograms?|mcg|µg)\b/, "mcg"],
  [/\b(grams?|gm|gms?|g)\b/, "g"],
  [/\b(tablets?|tabs?|tab)\b/, "tab"],
  [/\b(capsules?|caps?|cap)\b/, "cap"],
  [/\b(drops?)\b/, "drops"],
  [/\b(puffs?)\b/, "puff"],
  [/\b(units?|iu)\b/, "unit"],
];

const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fourteen: 14, twenty: 20, thirty: 30,
};

function wordToNum(w: string): number | null {
  if (/^\d+$/.test(w)) return parseInt(w, 10);
  return WORD_NUMBERS[w.toLowerCase()] ?? null;
}

// Extract a duration like "for 5 days", "x 7 days", "for one week", "for 2 weeks".
function extractDuration(segment: string): string | null {
  const m = /\b(?:for|x|times)?\s*(\d+|one|two|three|four|five|six|seven|eight|nine|ten|fourteen|twenty|thirty)\s*(day|days|week|weeks|month|months)\b/.exec(
    segment,
  );
  if (m) {
    const n = wordToNum(m[1]) ?? m[1];
    const unit = m[2].startsWith("day") ? "days" : m[2].startsWith("week") ? "weeks" : "months";
    return `${n} ${unit}`;
  }
  if (/\b(one|a)\s*week\b/.test(segment)) return "1 weeks";
  return null;
}

// Extract dose + unit like "500 mg", "650mg", "10 ml", "two tablets".
function extractDose(segment: string): { dosage: string; unit: string } | null {
  // numeric dose immediately followed by a unit
  const m = /\b(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten)\s*(milligrams?|mgs?|mg|millilitres?|milliliters?|mls?|ml|micrograms?|mcg|grams?|gms?|gm|g|tablets?|tabs?|tab|capsules?|caps?|cap|drops?|puffs?|units?|iu)\b/.exec(
    segment,
  );
  if (!m) return null;
  const doseNum = wordToNum(m[1]);
  const dosage = doseNum != null ? String(doseNum) : m[1];
  let unit = m[2];
  for (const [re, canon] of UNIT_MAP) {
    if (re.test(unit)) {
      unit = canon;
      break;
    }
  }
  return { dosage, unit };
}

function extractFrequency(segment: string): string | null {
  for (const [re, code] of FREQUENCY_MAP) {
    if (re.test(segment)) return code;
  }
  return null;
}

// Extract trailing instructions like "after food", "before meals", "with water".
function extractInstructions(segment: string): string | null {
  const m = /\b(after food|before food|after meals?|before meals?|with water|with milk|empty stomach|on an empty stomach)\b/.exec(
    segment,
  );
  return m ? m[1] : null;
}

// Find the best-matching known drug name within a segment. Returns the canonical
// name from the reference list when found, else the longest capitalized-ish token run.
function matchDrug(segment: string, knownDrugs: string[]): { name: string; matched: boolean } | null {
  const lower = segment.toLowerCase();
  // Longest known-drug name that appears as a word in the segment wins.
  let best: string | null = null;
  for (const d of knownDrugs) {
    const dl = d.toLowerCase();
    const re = new RegExp(`\\b${dl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
    if (re.test(lower) && (!best || d.length > best.length)) best = d;
  }
  if (best) return { name: best, matched: true };

  // Fallback: the token right after a verb like "start/give/prescribe/add/take".
  const verb = /\b(?:start|give|prescribe|add|take|continue|tab|cap|inj|syrup|tablet|capsule)\s+([a-z][a-z-]{2,})\b/.exec(lower);
  if (verb) {
    const word = verb[1];
    // Skip if it's actually a unit/frequency word.
    if (!UNIT_MAP.some(([re]) => re.test(word)) && !/^(one|two|three|four|five|daily|days|day)$/.test(word)) {
      return { name: word.charAt(0).toUpperCase() + word.slice(1), matched: false };
    }
  }
  return null;
}

// Pull the chief complaint / diagnosis out of the transcript.
function extractContext(transcript: string): { chiefComplaint?: string; diagnosisText?: string } {
  const out: { chiefComplaint?: string; diagnosisText?: string } = {};
  const cc = /\b(?:chief complaint|complains? of|presenting with|c\/o)\s*[:,]?\s*([^.;]+)/i.exec(transcript);
  if (cc) out.chiefComplaint = cc[1].trim().replace(/\s+/g, " ").slice(0, 200);
  const dx = /\b(?:diagnosis|diagnosed with|impression|assessment)\s*[:,]?\s*(?:is|of)?\s*([^.;]+)/i.exec(transcript);
  if (dx) out.diagnosisText = dx[1].trim().replace(/\s+/g, " ").slice(0, 200);
  return out;
}

// Split the transcript into medication clauses. We split on "and"/commas/semicolons/
// periods and on medication verbs so each clause holds at most one drug order.
function splitMedicationSegments(transcript: string): string[] {
  return transcript
    .replace(/\b(start|give|prescribe|add)\b/gi, "\n$1")
    .split(/[\n.;]|,\s*and\b|\band\b/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 2);
}

export function parseVoicePrescription(transcript: string, knownDrugs: string[]): ParsedPrescription {
  const clean = transcript.replace(/\s+/g, " ").trim();
  const context = extractContext(clean);

  const medications: ParsedMedication[] = [];
  const unmatched: string[] = [];
  const seen = new Set<string>();

  for (const segment of splitMedicationSegments(clean)) {
    const drug = matchDrug(segment, knownDrugs);
    const dose = extractDose(segment);
    const freq = extractFrequency(segment);
    const dur = extractDuration(segment);
    const instr = extractInstructions(segment);

    // A segment is a medication order only if we found a drug AND at least one of
    // dose/frequency/duration (avoids misreading complaint/diagnosis text as a drug).
    if (drug && (dose || freq || dur)) {
      const key = drug.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      medications.push({
        drugName: drug.name,
        dosage: dose?.dosage ?? "",
        unit: dose?.unit ?? "mg",
        frequency: freq ?? "BD",
        duration: dur ?? "5 days",
        instructions: instr ?? "",
        matchedDrug: drug.matched,
      });
    } else if (drug || dose || freq) {
      // Partial signal — surface for the doctor rather than dropping silently.
      unmatched.push(segment);
    }
  }

  return { ...context, medications, unmatchedSegments: unmatched };
}
