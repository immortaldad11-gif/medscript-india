import { PrismaClient, Role, DrugSchedule, InteractionSeverity, KycStatus } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// Small CDSCO-style reference set for Phase 1. Real deployment imports the full
// CDSCO approved drug list + RxNorm/DrugBank interaction data.
const DRUGS: Array<{ name: string; generic?: string; schedule: DrugSchedule; form?: string; strength?: string }> = [
  { name: "Amoxicillin", generic: "Amoxicillin", schedule: "H", form: "capsule", strength: "500mg" },
  { name: "Azithromycin", generic: "Azithromycin", schedule: "H", form: "tablet", strength: "500mg" },
  { name: "Ciprofloxacin", generic: "Ciprofloxacin", schedule: "H", form: "tablet", strength: "500mg" },
  { name: "Metformin", generic: "Metformin", schedule: "H", form: "tablet", strength: "500mg" },
  { name: "Atorvastatin", generic: "Atorvastatin", schedule: "H", form: "tablet", strength: "10mg" },
  { name: "Amlodipine", generic: "Amlodipine", schedule: "H", form: "tablet", strength: "5mg" },
  { name: "Warfarin", generic: "Warfarin", schedule: "H", form: "tablet", strength: "5mg" },
  { name: "Clopidogrel", generic: "Clopidogrel", schedule: "H", form: "tablet", strength: "75mg" },
  { name: "Tramadol", generic: "Tramadol", schedule: "H1", form: "tablet", strength: "50mg" },
  { name: "Alprazolam", generic: "Alprazolam", schedule: "H1", form: "tablet", strength: "0.5mg" },
  { name: "Codeine", generic: "Codeine", schedule: "H1", form: "syrup", strength: "10mg/5ml" },
  { name: "Morphine", generic: "Morphine", schedule: "X", form: "injection", strength: "10mg/ml" },
  { name: "Methylphenidate", generic: "Methylphenidate", schedule: "X", form: "tablet", strength: "10mg" },
  { name: "Paracetamol", generic: "Paracetamol", schedule: "OTC", form: "tablet", strength: "500mg" },
  { name: "Ibuprofen", generic: "Ibuprofen", schedule: "OTC", form: "tablet", strength: "400mg" },
  { name: "Cetirizine", generic: "Cetirizine", schedule: "OTC", form: "tablet", strength: "10mg" },
  { name: "Omeprazole", generic: "Omeprazole", schedule: "OTC", form: "capsule", strength: "20mg" },
  { name: "Aspirin", generic: "Aspirin", schedule: "OTC", form: "tablet", strength: "75mg" },
];

// Interaction pairs stored alphabetically (drugA < drugB) for deterministic lookup.
const INTERACTIONS: Array<{ a: string; b: string; severity: InteractionSeverity; description: string }> = [
  { a: "Clopidogrel", b: "Warfarin", severity: "CONTRAINDICATED", description: "Combined use markedly increases bleeding risk; concurrent use is generally contraindicated without specialist oversight." },
  { a: "Aspirin", b: "Warfarin", severity: "MAJOR", description: "Additive anticoagulant/antiplatelet effect raises risk of serious GI and intracranial bleeding." },
  { a: "Ciprofloxacin", b: "Warfarin", severity: "MAJOR", description: "Ciprofloxacin can potentiate warfarin, increasing INR and bleeding risk; monitor INR closely." },
  { a: "Alprazolam", b: "Tramadol", severity: "MAJOR", description: "CNS and respiratory depression risk when combining benzodiazepines with opioids." },
  { a: "Codeine", b: "Tramadol", severity: "MAJOR", description: "Additive opioid effect increases sedation and respiratory depression risk." },
  { a: "Atorvastatin", b: "Azithromycin", severity: "MODERATE", description: "Possible increased statin exposure; monitor for myopathy symptoms." },
  { a: "Amlodipine", b: "Atorvastatin", severity: "MINOR", description: "Amlodipine can modestly raise atorvastatin levels; clinically minor for standard doses." },
];

function norm(a: string, b: string) {
  return a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];
}

async function main() {
  console.log("Seeding drugs...");
  for (const d of DRUGS) {
    await prisma.drug.upsert({
      where: { name: d.name },
      update: { genericName: d.generic, schedule: d.schedule, form: d.form, strength: d.strength },
      create: { name: d.name, genericName: d.generic, schedule: d.schedule, form: d.form, strength: d.strength },
    });
  }

  console.log("Seeding drug interactions...");
  for (const i of INTERACTIONS) {
    const [a, b] = norm(i.a, i.b);
    await prisma.drugInteraction.upsert({
      where: { drugA_drugB: { drugA: a, drugB: b } },
      update: { severity: i.severity, description: i.description },
      create: { drugA: a, drugB: b, severity: i.severity, description: i.description },
    });
  }

  console.log("Seeding demo accounts...");
  const pwd = await bcrypt.hash("Password123!", 12);

  const admin = await prisma.user.upsert({
    where: { phone: "+919000000000" },
    update: {},
    create: {
      role: Role.SUPER_ADMIN,
      email: "admin@medscript.in",
      phone: "+919000000000",
      passwordHash: pwd,
      kycStatus: KycStatus.VERIFIED,
    },
  });

  const doctor = await prisma.user.upsert({
    where: { phone: "+919000000001" },
    update: {},
    create: {
      role: Role.DOCTOR,
      email: "doctor@medscript.in",
      phone: "+919000000001",
      passwordHash: pwd,
      mciRegNo: "MCI-DL-12345",
      kycStatus: KycStatus.VERIFIED,
      doctor: {
        create: {
          fullName: "Dr. Rajesh Kumar",
          specialisation: "General Medicine",
          qualification: "MBBS, MD",
          clinicName: "MedScript Demo Clinic",
          clinicAddress: "12 MG Road, Bengaluru, Karnataka 560001",
          gstin: "29ABCDE1234F1Z5",
          consultationFee: 50000,
        },
      },
    },
  });

  const patient = await prisma.user.upsert({
    where: { phone: "+919000000002" },
    update: {},
    create: {
      role: Role.PATIENT,
      email: "patient@medscript.in",
      phone: "+919000000002",
      passwordHash: pwd,
      kycStatus: KycStatus.VERIFIED,
      patient: {
        create: {
          fullName: "Asha Verma",
          gender: "Female",
          bloodGroup: "O+",
          allergies: ["Penicillin"],
          preferredLanguage: "en",
        },
      },
    },
  });

  const labTech = await prisma.user.upsert({
    where: { phone: "+919000000003" },
    update: {},
    create: {
      role: Role.LAB_TECHNICIAN,
      email: "lab@medscript.in",
      phone: "+919000000003",
      passwordHash: pwd,
      kycStatus: KycStatus.VERIFIED,
    },
  });

  const radiologist = await prisma.user.upsert({
    where: { phone: "+919000000004" },
    update: {},
    create: {
      role: Role.RADIOLOGIST,
      email: "radiology@medscript.in",
      phone: "+919000000004",
      passwordHash: pwd,
      kycStatus: KycStatus.VERIFIED,
    },
  });

  console.log("Seed complete.");
  console.log({
    admin: admin.email,
    doctor: doctor.email,
    patient: patient.email,
    lab: labTech.email,
    radiology: radiologist.email,
    password: "Password123!",
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
