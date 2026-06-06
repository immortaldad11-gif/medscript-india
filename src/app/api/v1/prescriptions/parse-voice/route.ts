import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, fail } from "@/lib/http";
import { AuthError, requireAuth } from "@/lib/auth";
import { parseVoiceSchema } from "@/lib/validation";
import { parseVoicePrescription } from "@/lib/voice-rx";
import { audit, clientIp } from "@/lib/audit";

// POST /api/v1/prescriptions/parse-voice — Section 4.2 (voice dictation).
// Doctor dictates; the browser transcribes via the Web Speech API and POSTs the text.
// We parse it into structured medication orders (matched against the reference drug
// list) for the doctor to review and edit. This NEVER creates or signs a prescription.
export async function POST(req: NextRequest) {
  let session;
  try {
    session = requireAuth(req, ["DOCTOR"]);
  } catch (err) {
    if (err instanceof AuthError) return fail(err.message, err.status, err.code);
    throw err;
  }

  const body = await req.json().catch(() => null);
  const parsed = parseVoiceSchema.safeParse(body);
  if (!parsed.success) return fail("Validation failed", 422, "VALIDATION_ERROR", parsed.error.flatten());

  // Reference drug names power high-confidence matching against the dictation.
  const drugs = await prisma.drug.findMany({ select: { name: true }, take: 5000 });
  const knownDrugs = drugs.map((d) => d.name);

  const result = parseVoicePrescription(parsed.data.transcript, knownDrugs);

  await audit({
    entityType: "prescription",
    action: "VOICE_PARSED",
    performedById: session.sub,
    ipAddress: clientIp(req),
    metadata: { medications: result.medications.length, unmatched: result.unmatchedSegments.length },
  });

  return ok(result);
}
