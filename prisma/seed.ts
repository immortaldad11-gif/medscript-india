import { PrismaClient, Role, KycStatus } from "@prisma/client";
import bcrypt from "bcryptjs";
import { DRUGS, INTERACTIONS } from "./formulary";

const prisma = new PrismaClient();

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
