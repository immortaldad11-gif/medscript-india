import type { DrugSchedule, InteractionSeverity } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// Schedule rules — Section 1.4 (Drugs & Cosmetics Act) + Telemedicine Guidelines 2020.
// Schedule X may NOT be prescribed via telemedicine (hard block).
// Schedule H1 requires stricter validation (patient address on record).

export interface ScheduleRuleResult {
  drugName: string;
  schedule: DrugSchedule;
  allowed: boolean;
  requiresAddress: boolean;
  reason?: string;
}

export const SCHEDULE_LABELS: Record<DrugSchedule, string> = {
  H: "Schedule H — prescription-only",
  H1: "Schedule H1 — enhanced control",
  X: "Schedule X — psychotropic/controlled",
  OTC: "OTC — unscheduled",
};

export function evaluateScheduleRule(drugName: string, schedule: DrugSchedule): ScheduleRuleResult {
  switch (schedule) {
    case "X":
      return {
        drugName,
        schedule,
        allowed: false,
        requiresAddress: true,
        reason: "Schedule X drugs are controlled and may only be prescribed in person — blocked via telemedicine.",
      };
    case "H1":
      return {
        drugName,
        schedule,
        allowed: true,
        requiresAddress: true,
        reason: "Schedule H1 requires patient address and stricter record-keeping.",
      };
    case "H":
      return { drugName, schedule, allowed: true, requiresAddress: false };
    case "OTC":
    default:
      return { drugName, schedule, allowed: true, requiresAddress: false };
  }
}

export interface DrugValidation {
  drugName: string;
  resolvedSchedule: DrugSchedule;
  known: boolean; // matched against CDSCO reference set
  rule: ScheduleRuleResult;
}

// Resolve each medication against the reference drug list and apply schedule rules.
export async function validateMedications(
  meds: Array<{ drugName: string; drugSchedule?: DrugSchedule }>,
): Promise<DrugValidation[]> {
  const names = meds.map((m) => m.drugName);
  const known = await prisma.drug.findMany({ where: { name: { in: names } } });
  const byName = new Map(known.map((d) => [d.name.toLowerCase(), d]));

  return meds.map((m) => {
    const ref = byName.get(m.drugName.toLowerCase());
    // Trust the reference list; fall back to the client-declared schedule, else H (safest default for an unknown Rx drug).
    const resolvedSchedule = (ref?.schedule ?? m.drugSchedule ?? "H") as DrugSchedule;
    return {
      drugName: m.drugName,
      resolvedSchedule,
      known: !!ref,
      rule: evaluateScheduleRule(m.drugName, resolvedSchedule),
    };
  });
}

export interface DetectedInteraction {
  drugA: string;
  drugB: string;
  severity: InteractionSeverity;
  description: string;
}

// Pairwise interaction check across all medications in the prescription — Section 4.1.2.
// Phase 1 uses the curated DrugInteraction table (RxNorm/DrugBank stand-in).
export async function detectInteractions(drugNames: string[]): Promise<DetectedInteraction[]> {
  const unique = Array.from(new Set(drugNames.map((n) => n.trim()).filter(Boolean)));
  if (unique.length < 2) return [];

  const all = await prisma.drugInteraction.findMany();
  const found: DetectedInteraction[] = [];

  for (let i = 0; i < unique.length; i++) {
    for (let j = i + 1; j < unique.length; j++) {
      const [a, b] = [unique[i], unique[j]];
      const match = all.find(
        (x) =>
          (x.drugA.toLowerCase() === a.toLowerCase() && x.drugB.toLowerCase() === b.toLowerCase()) ||
          (x.drugA.toLowerCase() === b.toLowerCase() && x.drugB.toLowerCase() === a.toLowerCase()),
      );
      if (match) {
        found.push({ drugA: a, drugB: b, severity: match.severity, description: match.description });
      }
    }
  }
  return found;
}
