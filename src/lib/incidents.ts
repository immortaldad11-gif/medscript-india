import { prisma } from "@/lib/prisma";
import { randomToken } from "@/lib/crypto";

// Operational incident reporting — Section 5.1 observability.
// The single sink for "something broke on the server". It does two things for every report:
//   1. Echoes to stdout/stderr so container/PaaS log collectors still capture it.
//   2. Persists to the incidents table so SUPER_ADMIN can review failures in-app and
//      correlate a user-reported request_id back to a stack trace.
// In production this is the natural seam to also fan out to Sentry/Datadog/PagerDuty — the
// call sites stay the same. Like audit(), it MUST NEVER throw into the primary request flow.

export type IncidentSeverity = "WARNING" | "ERROR" | "CRITICAL";

export interface ReportIncidentParams {
  source: string; // logical origin, e.g. "api:prescriptions:create"
  message: string; // human-readable summary
  severity?: IncidentSeverity; // defaults to ERROR
  error?: unknown; // thrown value — its stack/message becomes `detail`
  requestId?: string; // correlate to the response-envelope request_id; generated if omitted
  errorCode?: string;
  httpStatus?: number;
  method?: string;
  path?: string;
  userId?: string;
  ipAddress?: string | null;
  metadata?: Record<string, unknown>;
}

function detailOf(error: unknown): string | undefined {
  if (error == null) return undefined;
  if (error instanceof Error) return error.stack ?? error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

// Record an incident. Returns the requestId used (so callers can echo it to the client).
export async function reportIncident(params: ReportIncidentParams): Promise<string> {
  const requestId = params.requestId ?? randomToken(8);
  const severity = params.severity ?? "ERROR";
  const detail = detailOf(params.error);

  // 1. Always log — never let DB trouble hide the error itself.
  const line = `[incident:${severity}] ${params.source} (req ${requestId}) ${params.message}`;
  if (severity === "WARNING") console.warn(line, detail ?? "");
  else console.error(line, detail ?? "");

  // 2. Persist. Swallow any failure (mirrors audit()) — observability must not break flows.
  try {
    await prisma.incident.create({
      data: {
        requestId,
        severity,
        source: params.source,
        message: params.message,
        detail,
        errorCode: params.errorCode,
        httpStatus: params.httpStatus,
        method: params.method,
        path: params.path,
        userId: params.userId,
        ipAddress: params.ipAddress ?? undefined,
        metadata: params.metadata as object | undefined,
      },
    });
  } catch (err) {
    console.error("[incident] failed to persist:", (err as Error).message);
  }

  return requestId;
}

// Derive request context (method/path/ip) from a Request for incident metadata.
export function incidentContext(req?: Request): { method?: string; path?: string; ipAddress?: string | null } {
  if (!req) return {};
  let path: string | undefined;
  try {
    path = new URL(req.url).pathname;
  } catch {
    path = undefined;
  }
  const xff = req.headers.get("x-forwarded-for");
  const ipAddress = xff ? xff.split(",")[0].trim() : req.headers.get("x-real-ip");
  return { method: req.method, path, ipAddress };
}
