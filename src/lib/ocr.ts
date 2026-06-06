import type { ReportType } from "@prisma/client";

// OCR + structuring pipeline — Section 4.2 (Prescription OCR) + 4.3.1.
// Production: Google Cloud Vision (primary) + Tesseract (fallback) for image OCR,
// then a ClinicalBERT NLP pass to extract structured fields. DPDPA note: documents
// are de-identified before any call to Google; originals stay in India S3.
//
// Phase 1 of Phase 2 ships a stub: plain-text uploads are read directly; images
// return a placeholder. The structured-data shape matches what the real pipeline
// will emit, so callers and the UI are stable.

export interface StructuredReport {
  reportType: ReportType;
  reportDate: string | null;
  labName: string | null;
  doctorName: string | null;
  findings: Array<{ name: string; value: string; unit?: string; referenceRange?: string }>;
}

export interface OcrResult {
  ocrText: string;
  structured: StructuredReport;
  confidence: number;
}

export async function runOcr(file: { buffer: Buffer; mimeType: string; reportType: ReportType }): Promise<OcrResult> {
  const isText = file.mimeType.startsWith("text/") || file.mimeType === "application/json";
  const ocrText = isText
    ? file.buffer.toString("utf8").slice(0, 20000)
    : "[OCR pending — image/PDF will be processed by the AI/NLP service in production]";

  return {
    ocrText,
    confidence: isText ? 0.99 : 0.5,
    structured: {
      reportType: file.reportType,
      reportDate: null,
      labName: null,
      doctorName: null,
      findings: [],
    },
  };
}
