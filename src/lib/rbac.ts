import type { Role } from "@prisma/client";

// Permission matrix — Section 2.4. Each permission maps to the roles allowed to
// perform it. "withConsent"/"ownOnly" nuances are enforced at the data layer;
// this table gates the coarse-grained capability.

export type Permission =
  | "prescription:create"
  | "prescription:viewOwn"
  | "patient:viewRecords"
  | "report:upload"
  | "consent:manage"
  | "voiceInput"
  | "document:download"
  | "whatsapp:share"
  | "analytics:view"
  | "interaction:alerts"
  | "user:manage";

const MATRIX: Record<Permission, Role[]> = {
  "prescription:create": ["DOCTOR"],
  "prescription:viewOwn": ["DOCTOR", "PATIENT", "SUPER_ADMIN"],
  "patient:viewRecords": ["DOCTOR", "PATIENT", "SUPER_ADMIN"],
  "report:upload": ["PATIENT", "LAB_TECHNICIAN", "RADIOLOGIST", "SUPER_ADMIN"],
  "consent:manage": ["PATIENT"],
  voiceInput: ["DOCTOR"],
  "document:download": ["DOCTOR", "PATIENT", "SUPER_ADMIN"],
  "whatsapp:share": ["DOCTOR", "PATIENT"],
  "analytics:view": ["DOCTOR", "SUPER_ADMIN"],
  "interaction:alerts": ["DOCTOR", "SUPER_ADMIN"],
  "user:manage": ["SUPER_ADMIN"],
};

export function can(role: Role, permission: Permission): boolean {
  return MATRIX[permission].includes(role);
}
