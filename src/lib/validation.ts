import { z } from "zod";

// Shared Zod schemas — reused by API routes and (where possible) the client forms
// so types stay in sync (Section 3.1).

export const phoneSchema = z
  .string()
  .regex(/^\+\d{10,15}$/, "Phone must be in E.164 format, e.g. +919876543210");

export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .regex(/[A-Z]/, "Must contain an uppercase letter")
  .regex(/[a-z]/, "Must contain a lowercase letter")
  .regex(/[0-9]/, "Must contain a number");

export const registerDoctorSchema = z.object({
  role: z.literal("DOCTOR"),
  phone: phoneSchema,
  email: z.string().email().optional(),
  password: passwordSchema,
  mciRegNo: z.string().min(3, "MCI/NMC registration number is required"),
  fullName: z.string().min(2),
  specialisation: z.string().optional(),
  qualification: z.string().optional(),
  clinicName: z.string().optional(),
  clinicAddress: z.string().optional(),
  gstin: z.string().optional(),
});

export const registerPatientSchema = z.object({
  role: z.literal("PATIENT"),
  phone: phoneSchema,
  email: z.string().email().optional(),
  password: passwordSchema,
  fullName: z.string().min(2),
  gender: z.string().optional(),
  dob: z.string().optional(),
  bloodGroup: z.string().optional(),
  abhaId: z.string().optional(),
});

export const registerSchema = z.discriminatedUnion("role", [registerDoctorSchema, registerPatientSchema]);

export const loginSchema = z.object({
  identifier: z.string().min(3), // phone or email
  password: z.string().min(1),
  totp: z.string().optional(),
});

export const medicationInputSchema = z.object({
  drugName: z.string().min(1),
  drugSchedule: z.enum(["H", "H1", "X", "OTC"]).optional(),
  dosage: z.string().min(1),
  unit: z.string().min(1),
  frequency: z.string().min(1),
  duration: z.string().min(1),
  route: z.string().optional(),
  instructions: z.string().optional(),
  prn: z.boolean().optional(),
});

export const createPrescriptionSchema = z.object({
  patientId: z.string().uuid().optional(),
  patientPhone: phoneSchema.optional(),
  patientName: z.string().min(2),
  chiefComplaint: z.string().max(500).optional(),
  diagnosisIcd10: z.string().optional(),
  diagnosisText: z.string().optional(),
  notes: z.string().optional(),
  followUpDate: z.string().optional(),
  vitals: z.record(z.string()).optional(),
  medications: z.array(medicationInputSchema).min(1, "At least one medication is required"),
  // For CONTRAINDICATED interactions the doctor must supply a typed justification (Section 4.1.2).
  interactionOverrides: z
    .array(z.object({ drugA: z.string(), drugB: z.string(), justification: z.string().min(10) }))
    .optional(),
  idempotencyKey: z.string().optional(),
});

export type CreatePrescriptionInput = z.infer<typeof createPrescriptionSchema>;
export type MedicationInput = z.infer<typeof medicationInputSchema>;

export const grantConsentSchema = z.object({
  granteeId: z.string().uuid().optional(),
  granteeMciRegNo: z.string().optional(),
  reportIds: z.array(z.string().uuid()).min(1, "Select at least one document to share"),
  purpose: z.string().min(3).default("Consultation"),
  // Duration presets from Section 4.3.2 (1h / 24h / 7d / custom seconds).
  ttlSeconds: z
    .number()
    .int()
    .min(300, "Minimum 5 minutes")
    .max(30 * 24 * 3600, "Maximum 30 days")
    .default(24 * 3600),
});

export type GrantConsentRequest = z.infer<typeof grantConsentSchema>;

// ABHA / ABDM linking (Section 2.2). Either a 14-digit number or an ABHA address.
export const abhaInitSchema = z
  .object({
    abhaNumber: z.string().optional(),
    abhaAddress: z.string().optional(),
  })
  .refine((d) => !!d.abhaNumber || !!d.abhaAddress, {
    message: "Provide an ABHA number or ABHA address",
  });

export const abhaVerifySchema = z.object({
  txnId: z.string().min(10),
  otp: z.string().min(4).max(8),
});

export type AbhaInitRequest = z.infer<typeof abhaInitSchema>;
export type AbhaVerifyRequest = z.infer<typeof abhaVerifySchema>;

// Voice-to-prescription: the dictated transcript to parse into structured orders.
export const parseVoiceSchema = z.object({
  transcript: z.string().min(3, "Transcript is empty").max(5000),
});
