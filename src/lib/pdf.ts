import PDFDocument from "pdfkit";
import QRCode from "qrcode";

// Prescription PDF generator — Section 4.4.1. The doc names Puppeteer (HTML→PDF);
// Phase 1 uses PDFKit to avoid bundling a headless browser. Layout parity is kept:
// clinic header, patient block with allergy alerts, medications table, QR, signature
// footer, and a "DO NOT ALTER" watermark.

export interface PdfMedication {
  drugName: string;
  schedule: string;
  dosage: string;
  unit: string;
  frequency: string;
  duration: string;
  instructions?: string | null;
}

export interface PrescriptionPdfData {
  prescriptionId: string;
  issuedAt: Date;
  clinic: {
    name: string;
    address?: string | null;
    gstin?: string | null;
  };
  doctor: {
    name: string;
    qualification?: string | null;
    mciRegNo?: string | null;
    phone?: string | null;
  };
  patient: {
    name: string;
    abhaNumber?: string | null; // masked 14-digit ABHA number (e.g. XX-XXXX-XXXX-1234)
    abhaAddress?: string | null; // ABHA address handle (e.g. ramesh@abdm)
    age?: string | null;
    gender?: string | null;
    bloodGroup?: string | null;
    allergies: string[];
  };
  diagnosis?: string | null;
  chiefComplaint?: string | null;
  notes?: string | null;
  followUpDate?: Date | null;
  medications: PdfMedication[];
  verifyUrl: string;
  signatureHash: string;
  signatureAlg?: string | null; // e.g. "RSA-SHA256" when DSC-signed
  signingCertSerial?: string | null; // DSC certificate serial
}

const BRAND = "#0a5fa0";
const GREY = "#666666";
const RED = "#c0392b";

export async function generatePrescriptionPdf(data: PrescriptionPdfData): Promise<Buffer> {
  const qrPng = await QRCode.toBuffer(data.verifyUrl, { margin: 1, width: 120 });

  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pageWidth = doc.page.width;
    const left = doc.page.margins.left;
    const right = pageWidth - doc.page.margins.right;
    const contentWidth = right - left;

    // --- Header: clinic + doctor ---
    doc.fillColor(BRAND).fontSize(20).font("Helvetica-Bold").text(data.clinic.name, left, 40);
    doc.fillColor("#000").fontSize(11).font("Helvetica-Bold").text(data.doctor.name, { continued: false });
    doc.fillColor(GREY).fontSize(9).font("Helvetica");
    const docLine = [data.doctor.qualification, data.doctor.mciRegNo ? `Reg. No: ${data.doctor.mciRegNo}` : null]
      .filter(Boolean)
      .join("  ·  ");
    if (docLine) doc.text(docLine);
    if (data.clinic.address) doc.text(data.clinic.address);
    const metaLine = [data.doctor.phone, data.clinic.gstin ? `GSTIN: ${data.clinic.gstin}` : null].filter(Boolean).join("  ·  ");
    if (metaLine) doc.text(metaLine);

    // QR code top-right
    doc.image(qrPng, right - 90, 40, { width: 90 });
    doc.fillColor(GREY).fontSize(7).text("Scan to verify", right - 90, 132, { width: 90, align: "center" });

    doc.moveTo(left, 150).lineTo(right, 150).strokeColor(BRAND).lineWidth(1.5).stroke();

    // --- Prescription meta ---
    let y = 160;
    doc.fillColor("#000").fontSize(9).font("Helvetica");
    doc.text(`Prescription ID: ${data.prescriptionId}`, left, y);
    doc.text(`Date: ${data.issuedAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`, left, y + 12);

    // --- Patient block ---
    y += 36;
    doc.fillColor(BRAND).fontSize(11).font("Helvetica-Bold").text("Patient", left, y);
    y += 16;
    doc.fillColor("#000").fontSize(10).font("Helvetica");
    const abhaBits = [data.patient.abhaNumber, data.patient.abhaAddress].filter(Boolean).join(" · ");
    const patientBits = [
      `Name: ${data.patient.name}`,
      data.patient.age ? `Age: ${data.patient.age}` : null,
      data.patient.gender ? `Gender: ${data.patient.gender}` : null,
      data.patient.bloodGroup ? `Blood: ${data.patient.bloodGroup}` : null,
      abhaBits ? `ABHA: ${abhaBits}` : null,
    ].filter(Boolean);
    doc.text(patientBits.join("   |   "), left, y, { width: contentWidth });
    y = doc.y + 4;
    if (data.patient.allergies.length > 0) {
      doc.fillColor(RED).font("Helvetica-Bold").text(`⚠ Allergies: ${data.patient.allergies.join(", ")}`, left, y, {
        width: contentWidth,
      });
      y = doc.y;
    }

    // --- Clinical context ---
    y += 10;
    doc.fillColor("#000").fontSize(10).font("Helvetica");
    if (data.chiefComplaint) {
      doc.font("Helvetica-Bold").text("Chief Complaint: ", left, y, { continued: true }).font("Helvetica").text(data.chiefComplaint);
      y = doc.y + 2;
    }
    if (data.diagnosis) {
      doc.font("Helvetica-Bold").text("Diagnosis: ", left, y, { continued: true }).font("Helvetica").text(data.diagnosis);
      y = doc.y + 2;
    }

    // --- Medications table ---
    y += 10;
    doc.fillColor(BRAND).fontSize(11).font("Helvetica-Bold").text("Rx — Medications", left, y);
    y += 18;

    const cols = [
      { label: "Drug", w: 0.3 },
      { label: "Dosage", w: 0.13 },
      { label: "Frequency", w: 0.15 },
      { label: "Duration", w: 0.14 },
      { label: "Instructions", w: 0.28 },
    ];
    const colX: number[] = [];
    let acc = left;
    for (const c of cols) {
      colX.push(acc);
      acc += c.w * contentWidth;
    }

    // header row
    doc.rect(left, y, contentWidth, 18).fillColor("#eef4fa").fill();
    doc.fillColor(BRAND).fontSize(9).font("Helvetica-Bold");
    cols.forEach((c, i) => doc.text(c.label, colX[i] + 4, y + 5, { width: c.w * contentWidth - 8 }));
    y += 18;

    doc.font("Helvetica").fillColor("#000").fontSize(9);
    for (const m of data.medications) {
      const drugLabel = `${m.drugName}${m.schedule && m.schedule !== "OTC" ? ` [${m.schedule}]` : ""}`;
      const cells = [drugLabel, `${m.dosage} ${m.unit}`, m.frequency, m.duration, m.instructions ?? "-"];
      const heights = cells.map((text, i) => doc.heightOfString(text, { width: cols[i].w * contentWidth - 8 }));
      const rowH = Math.max(16, ...heights) + 6;
      if (y + rowH > doc.page.height - 120) {
        doc.addPage();
        y = 60;
      }
      cells.forEach((text, i) => doc.text(text, colX[i] + 4, y + 3, { width: cols[i].w * contentWidth - 8 }));
      y += rowH;
      doc.moveTo(left, y).lineTo(right, y).strokeColor("#dddddd").lineWidth(0.5).stroke();
    }

    // --- Notes + follow-up ---
    y += 12;
    if (data.notes) {
      doc.fillColor("#000").fontSize(10).font("Helvetica-Bold").text("Advice / Notes:", left, y);
      doc.font("Helvetica").text(data.notes, left, doc.y + 2, { width: contentWidth });
      y = doc.y + 6;
    }
    if (data.followUpDate) {
      doc.font("Helvetica-Bold").fontSize(10).text(`Follow-up: ${data.followUpDate.toLocaleDateString("en-IN")}`, left, y);
      y = doc.y + 6;
    }

    // --- Footer: signature block ---
    const footerY = doc.page.height - 96;
    doc.moveTo(left, footerY).lineTo(right, footerY).strokeColor(BRAND).lineWidth(1).stroke();
    const signedLabel = data.signatureAlg
      ? `Digitally signed (DSC · ${data.signatureAlg})`
      : "Digitally signed";
    doc.fillColor("#000").fontSize(9).font("Helvetica-Bold").text(signedLabel, left, footerY + 8);
    doc.fillColor(GREY).fontSize(7).font("Helvetica").text(`Signature hash: ${data.signatureHash}`, left, footerY + 20, {
      width: contentWidth * 0.6,
    });
    if (data.signingCertSerial) {
      doc.text(`DSC cert serial: ${data.signingCertSerial}`, left, footerY + 30, { width: contentWidth * 0.6 });
    }
    doc.fontSize(8).text("Valid prescription under Telemedicine Practice Guidelines 2020", left, footerY + 44, {
      width: contentWidth,
    });
    doc.font("Helvetica-Bold").fillColor(BRAND).fontSize(9).text(data.doctor.name, right - 180, footerY + 30, {
      width: 180,
      align: "right",
    });

    // --- Watermark on every page ---
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.save();
      doc.rotate(-30, { origin: [pageWidth / 2, doc.page.height / 2] });
      doc.fillColor("#000").opacity(0.06).fontSize(40).font("Helvetica-Bold");
      doc.text("DIGITAL PRESCRIPTION — DO NOT ALTER", 0, doc.page.height / 2 - 20, {
        width: pageWidth,
        align: "center",
      });
      doc.restore();
      doc.opacity(1);
    }

    doc.end();
  });
}
