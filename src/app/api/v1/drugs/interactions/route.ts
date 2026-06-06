import type { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail } from "@/lib/http";
import { AuthError, requireAuth } from "@/lib/auth";
import { detectInteractions, validateMedications } from "@/lib/drug-schedules";

const schema = z.object({ drugNames: z.array(z.string().min(1)).max(50) });

// POST /api/v1/drugs/interactions — real-time interaction + schedule check used by
// the Rx form as the doctor adds each drug (Section 4.1.2).
export async function POST(req: NextRequest) {
  try {
    requireAuth(req, ["DOCTOR", "SUPER_ADMIN"]);
  } catch (err) {
    if (err instanceof AuthError) return fail(err.message, err.status, err.code);
    throw err;
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return fail("Validation failed", 422, "VALIDATION_ERROR", parsed.error.flatten());

  const [interactions, schedules] = await Promise.all([
    detectInteractions(parsed.data.drugNames),
    validateMedications(parsed.data.drugNames.map((drugName) => ({ drugName }))),
  ]);

  return ok({
    interactions,
    schedules: schedules.map((s) => ({
      drugName: s.drugName,
      schedule: s.resolvedSchedule,
      allowed: s.rule.allowed,
      reason: s.rule.reason,
      known: s.known,
    })),
  });
}
