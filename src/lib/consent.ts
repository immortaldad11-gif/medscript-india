import type { ConsentArtefact } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { redis, redisAvailable } from "@/lib/redis";
import { randomToken } from "@/lib/crypto";

// Consent framework — Section 2.2.5 + 4.3. The DB is the source of truth for
// correctness; Redis provides O(1) revocation/validation as described in 4.3.3.
// A consent grants a specific grantee (doctor) access to specific MedicalReport IDs
// for a bounded time, backed by a Temporary Access Token (TAT).

const TAT_PREFIX = "tat:";

export interface GrantConsentInput {
  patientId: string;
  granteeId: string;
  granteeType: "DOCTOR" | "LAB_TECHNICIAN" | "RADIOLOGIST";
  purpose: string;
  reportIds: string[];
  dataTypes: string[];
  ttlSeconds: number;
}

export async function grantConsent(input: GrantConsentInput) {
  const expiresAt = new Date(Date.now() + input.ttlSeconds * 1000);
  const tat = randomToken(24);

  const consent = await prisma.consentArtefact.create({
    data: {
      patientId: input.patientId,
      granteeId: input.granteeId,
      granteeType: input.granteeType,
      purpose: input.purpose,
      dataTypes: input.dataTypes,
      reportIds: input.reportIds,
      expiresAt,
      status: "ACTIVE",
      accessGrants: {
        create: { tempAccessToken: tat, expiresAt },
      },
    },
    include: { accessGrants: true },
  });

  // Fast-path validation/revocation cache. TTL mirrors the consent expiry so the
  // key disappears automatically (the "automatic expiry" of Section 4.3.3).
  if (redisAvailable() && redis) {
    await redis.set(TAT_PREFIX + tat, consent.id, "EX", input.ttlSeconds);
  }

  return consent;
}

// Returns the live consent if the grantee may currently access it, else null.
// Lazily flips expired consents to EXPIRED (the BullMQ auto-revoke job's effect).
export async function resolveActiveConsent(consentId: string, granteeId: string): Promise<ConsentArtefact | null> {
  const consent = await prisma.consentArtefact.findUnique({
    where: { id: consentId },
    include: { accessGrants: true },
  });
  if (!consent || consent.granteeId !== granteeId) return null;
  if (consent.status === "REVOKED") return null;

  if (consent.expiresAt < new Date()) {
    if (consent.status !== "EXPIRED") {
      await prisma.consentArtefact.update({ where: { id: consent.id }, data: { status: "EXPIRED" } });
    }
    return null;
  }

  // Fast revocation check: if Redis is up and the TAT key is gone, treat as revoked.
  if (redisAvailable() && redis) {
    const tat = consent.accessGrants[0]?.tempAccessToken;
    if (tat) {
      const exists = await redis.exists(TAT_PREFIX + tat);
      if (!exists) return null;
    }
  }

  return consent;
}

export async function revokeConsent(consentId: string, patientId: string): Promise<boolean> {
  const consent = await prisma.consentArtefact.findUnique({
    where: { id: consentId },
    include: { accessGrants: true },
  });
  if (!consent || consent.patientId !== patientId) return false;

  await prisma.consentArtefact.update({
    where: { id: consentId },
    data: { status: "REVOKED", revokedAt: new Date() },
  });

  // O(1) invalidation — any in-flight access check fails immediately.
  if (redisAvailable() && redis) {
    const keys = consent.accessGrants.map((g) => TAT_PREFIX + g.tempAccessToken);
    if (keys.length) await redis.del(...keys);
  }
  return true;
}

export function reportIdsOf(consent: { reportIds: unknown }): string[] {
  return Array.isArray(consent.reportIds) ? (consent.reportIds as string[]) : [];
}
