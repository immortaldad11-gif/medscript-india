import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { describeStorage } from "@/lib/storage";
import { listDscCertificates } from "@/lib/dsc";
import { getSession } from "@/lib/auth";

// GET /api/v1/health — liveness/readiness probe (Section 5.1 observability).
// Two audiences, one endpoint:
//   - Anonymous (load balancers, uptime monitors): coarse up/down booleans only — no
//     filesystem paths, bucket names, or serials, so the probe never leaks topology.
//   - SUPER_ADMIN: the same payload enriched with latencies and backend descriptors for
//     on-call diagnostics.
// The database is the only hard dependency: if it is down we answer 503. Redis is optional
// (the app degrades gracefully without it), so a Redis outage reports "degraded" but 200.
export const dynamic = "force-dynamic";

async function checkDatabase(): Promise<{ up: boolean; latencyMs: number | null }> {
  const started = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { up: true, latencyMs: Date.now() - started };
  } catch {
    return { up: false, latencyMs: null };
  }
}

async function checkRedis(): Promise<{ up: boolean; latencyMs: number | null; status: string }> {
  if (!redis) return { up: false, latencyMs: null, status: "not-configured" };
  const started = Date.now();
  try {
    const pong = await redis.ping();
    return { up: pong === "PONG", latencyMs: Date.now() - started, status: redis.status };
  } catch {
    return { up: false, latencyMs: null, status: redis.status };
  }
}

function checkDsc(): { up: boolean; activeSerial: string | null; certCount: number } {
  try {
    const certs = listDscCertificates();
    const active = certs.find((c) => c.active) ?? null;
    return { up: certs.length > 0 && !!active, activeSerial: active?.serial ?? null, certCount: certs.length };
  } catch {
    return { up: false, activeSerial: null, certCount: 0 };
  }
}

export async function GET(req: NextRequest) {
  const isAdmin = getSession(req)?.role === "SUPER_ADMIN";

  const [database, redisCheck] = await Promise.all([checkDatabase(), checkRedis()]);
  const dsc = checkDsc();
  // describeStorage() only reports the configured backend; it does not touch the store.
  let storageUp = true;
  let storageDriver: string | null = null;
  try {
    storageDriver = describeStorage();
  } catch {
    storageUp = false;
  }

  const healthy = database.up; // hard dependency
  const status = !database.up ? "down" : redisCheck.up && dsc.up && storageUp ? "ok" : "degraded";

  // Coarse, leak-free view for anonymous probes.
  const payload: Record<string, unknown> = {
    status,
    uptimeSeconds: Math.round(process.uptime()),
    version: process.env.npm_package_version ?? "0.1.0",
    time: new Date().toISOString(),
    checks: {
      database: { up: database.up },
      redis: { up: redisCheck.up },
      storage: { up: storageUp },
      dsc: { up: dsc.up },
    },
  };

  // Richer diagnostics only for an authenticated SUPER_ADMIN.
  if (isAdmin) {
    payload.checks = {
      database,
      redis: redisCheck,
      storage: { up: storageUp, driver: storageDriver },
      dsc,
    };
  }

  return healthy ? ok(payload) : fail("Service unhealthy", 503, "UNHEALTHY", payload);
}
