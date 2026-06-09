import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, fail } from "@/lib/http";
import { AuthError, requireAuth } from "@/lib/auth";
import { putObject } from "@/lib/storage";
import { audit, clientIp } from "@/lib/audit";
import { resolvePatient } from "@/lib/patients";
import { enqueueOcr } from "@/lib/queue";
import type { ReportType } from "@prisma/client";

const MAX_BYTES = 15 * 1024 * 1024; // 15 MB
const REPORT_TYPES: ReportType[] = ["LAB", "RADIOLOGY", "PRESCRIPTION"];

// Allow-list of upload content types. Deliberately excludes active types (text/html,
// image/svg+xml, xhtml, etc.): a document is later served back with its stored mime
// type, so permitting an active type would let an uploaded file execute script in the
// app origin when a clinician opens it — stored XSS. Only inert document/image types
// are accepted. (file.type is client-declared, but since we serve back exactly this
// allow-listed type with nosniff, malicious bytes under a benign type stay inert.)
const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/tiff",
  "application/dicom",
  "text/plain",
]);

// POST /api/v1/documents/upload (multipart) — Section 4.3.1.
// Patients upload their own documents; labs/radiologists upload for a patient
// (resolved by patientId). File is OCR-structured then stored encrypted-at-rest in
// the patient's private partition — no one else can access it until consent is granted.
export async function POST(req: NextRequest) {
  let session;
  try {
    session = requireAuth(req, ["PATIENT", "LAB_TECHNICIAN", "RADIOLOGIST", "SUPER_ADMIN"]);
  } catch (err) {
    if (err instanceof AuthError) return fail(err.message, err.status, err.code);
    throw err;
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail("Expected multipart/form-data", 400, "INVALID_BODY");
  }

  const file = form.get("file");
  if (!(file instanceof File)) return fail("Missing file", 422, "NO_FILE");
  if (file.size > MAX_BYTES) return fail("File exceeds 15 MB limit", 413, "TOO_LARGE");
  const mime = (file.type || "").toLowerCase();
  if (!ALLOWED_MIME.has(mime)) {
    return fail(
      `Unsupported file type "${file.type || "unknown"}". Allowed: PDF, PNG, JPEG, WEBP, GIF, TIFF, DICOM, TXT.`,
      415,
      "UNSUPPORTED_TYPE",
    );
  }

  const reportTypeRaw = String(form.get("reportType") ?? "LAB").toUpperCase();
  const reportType = (REPORT_TYPES.includes(reportTypeRaw as ReportType) ? reportTypeRaw : "LAB") as ReportType;
  const title = (form.get("title") as string) || file.name;

  // Resolve the owning patient. Patients upload for themselves; staff supply either
  // a patientId or a patientPhone (a placeholder account is created if needed).
  let patientId = session.sub;
  if (session.role !== "PATIENT") {
    const provided = form.get("patientId");
    const phone = form.get("patientPhone");
    if (!provided && !phone) return fail("patientId or patientPhone is required for staff uploads", 422, "NO_PATIENT");
    const patient = await resolvePatient({
      patientId: provided ? String(provided) : undefined,
      patientPhone: phone ? String(phone) : undefined,
      patientName: String(form.get("patientName") ?? "Patient"),
    });
    if (!patient) return fail("Patient not found", 422, "PATIENT_NOT_FOUND");
    patientId = patient.id;
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // Persist metadata + encrypted bytes first; OCR structuring runs afterwards
  // (async via BullMQ when enabled, inline otherwise).
  const report = await prisma.medicalReport.create({
    data: {
      patientId,
      uploadedById: session.sub,
      reportType,
      title,
      s3Key: "", // set after we know the id
      originalFilename: file.name,
      mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      ocrStatus: "PENDING",
      isVerified: session.role === "LAB_TECHNICIAN" || session.role === "RADIOLOGIST",
    },
  });

  const storageKey = `${patientId}/${report.id}`;
  await putObject(storageKey, buffer);
  const saved = await prisma.medicalReport.update({ where: { id: report.id }, data: { s3Key: storageKey } });

  await audit({
    entityType: "medical_report",
    entityId: saved.id,
    action: "DOCUMENT_UPLOADED",
    performedById: session.sub,
    ipAddress: clientIp(req),
    metadata: { reportType, sizeBytes: file.size },
  });

  // Kick off OCR. queued=true → processed by the worker; false → already done inline.
  const { queued } = await enqueueOcr(saved.id);
  const fresh = queued ? saved : await prisma.medicalReport.findUnique({ where: { id: saved.id } });

  return ok(
    {
      id: saved.id,
      title: saved.title,
      reportType: saved.reportType,
      mimeType: saved.mimeType,
      sizeBytes: saved.sizeBytes,
      createdAt: saved.createdAt,
      ocrStatus: fresh?.ocrStatus ?? "PENDING",
      structuredData: fresh?.structuredData ?? null,
    },
    201,
  );
}
