import { NextResponse } from "next/server";
import { randomToken } from "@/lib/crypto";
import { reportIncident, incidentContext, type IncidentSeverity } from "@/lib/incidents";

// Standard error/response envelope — Section 7.1:
// { success, message, error_code, data, request_id }

export function ok<T>(data: T, status = 200) {
  return NextResponse.json(
    { success: true, message: "OK", error_code: null, data, request_id: randomToken(8) },
    { status },
  );
}

export function fail(
  message: string,
  status = 400,
  errorCode = "BAD_REQUEST",
  data: unknown = null,
  // When supplied, the envelope reuses this id — so failWithIncident() can return the SAME
  // request_id it recorded on the incident, letting a caller quote it to support.
  requestId = randomToken(8),
) {
  return NextResponse.json(
    { success: false, message, error_code: errorCode, data, request_id: requestId },
    { status },
  );
}

// Record a server-side incident AND return the matching error envelope. Use this in route
// catch-blocks for unexpected failures (5xx): the user gets a request_id they can quote, and
// an admin can look that exact id up in the Incidents view to see the stack trace.
export async function failWithIncident(opts: {
  message: string; // user-facing message (kept generic — detail lives in the incident, server-side)
  source: string; // logical origin, e.g. "api:prescriptions:create"
  error?: unknown; // the caught error — its stack is stored server-side only
  status?: number; // defaults to 500
  errorCode?: string; // defaults to "INTERNAL"
  data?: unknown;
  severity?: IncidentSeverity; // defaults to ERROR
  req?: Request; // captures method/path/ip for the incident
  userId?: string;
  metadata?: Record<string, unknown>;
}): Promise<NextResponse> {
  const requestId = randomToken(8);
  const ctx = incidentContext(opts.req);
  await reportIncident({
    requestId,
    source: opts.source,
    message: opts.message,
    severity: opts.severity ?? "ERROR",
    error: opts.error,
    errorCode: opts.errorCode ?? "INTERNAL",
    httpStatus: opts.status ?? 500,
    userId: opts.userId,
    metadata: opts.metadata,
    ...ctx,
  });
  return fail(opts.message, opts.status ?? 500, opts.errorCode ?? "INTERNAL", opts.data ?? null, requestId);
}
