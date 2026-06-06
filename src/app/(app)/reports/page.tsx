"use client";

import { useEffect, useState, useRef } from "react";
import { apiGet, ApiError } from "@/lib/api-client";

interface Report {
  id: string;
  title: string | null;
  reportType: string;
  originalFilename: string | null;
  sizeBytes: number | null;
  isVerified: boolean;
  createdAt: string;
  patientName: string | null;
  patientPhone: string | null;
}

interface Patient {
  id: string;
  phone: string;
  fullName: string | null;
}

function fmtSize(n: number | null): string {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function ReportsPage() {
  const [rows, setRows] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);

  // Patient lookup.
  const [phone, setPhone] = useState("");
  const [patient, setPatient] = useState<Patient | null>(null);
  const [lookupMsg, setLookupMsg] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [notFound, setNotFound] = useState(false);

  // Upload.
  const [reportType, setReportType] = useState("LAB");
  const [title, setTitle] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    setLoading(true);
    setRows(await apiGet<Report[]>("/api/v1/documents").catch(() => []));
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function lookup() {
    setPatient(null);
    setNotFound(false);
    setLookupMsg(null);
    setError(null);
    if (!phone.trim()) return;
    try {
      const p = await apiGet<Patient>(`/api/v1/patients/lookup?phone=${encodeURIComponent(phone.trim())}`);
      setPatient(p);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        setNotFound(true);
        setLookupMsg("No patient registered with this number — a placeholder account will be created on upload.");
      } else {
        setLookupMsg(e instanceof ApiError ? e.message : "Lookup failed");
      }
    }
  }

  async function upload() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Choose a file first");
      return;
    }
    if (!patient && !notFound) {
      setError("Look up the patient first");
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("reportType", reportType);
      if (title.trim()) form.append("title", title.trim());
      if (patient) form.append("patientId", patient.id);
      else {
        form.append("patientPhone", phone.trim());
        form.append("patientName", newName.trim() || "Patient");
      }
      const res = await fetch("/api/v1/documents/upload", { method: "POST", body: form, credentials: "include" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.message ?? "Upload failed");
      if (fileRef.current) fileRef.current.value = "";
      setTitle("");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900">Upload Reports</h1>
      <p className="mt-1 text-sm text-slate-500">
        Upload lab/radiology reports on behalf of a patient. They appear in the patient&apos;s record automatically.
      </p>

      {/* Lookup + upload */}
      <div className="card mt-6 p-5">
        <p className="label">1. Find the patient</p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <input
            className="input w-auto"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+919876543210"
            onKeyDown={(e) => e.key === "Enter" && lookup()}
          />
          <button className="btn-ghost" onClick={lookup}>
            Look up
          </button>
          {patient && (
            <span className="rounded bg-emerald-50 px-3 py-1.5 text-sm text-emerald-700">
              Found: {patient.fullName ?? "Unnamed"} ({patient.phone})
            </span>
          )}
        </div>
        {lookupMsg && <p className="mt-2 text-sm text-amber-700">{lookupMsg}</p>}
        {notFound && (
          <div className="mt-3">
            <label className="label">New patient name</label>
            <input
              className="input mt-1 w-72"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Full name"
            />
          </div>
        )}

        {(patient || notFound) && (
          <>
            <p className="label mt-5">2. Upload the report</p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <input ref={fileRef} type="file" className="text-sm" accept=".pdf,.png,.jpg,.jpeg,.txt" />
              <select className="input w-auto" value={reportType} onChange={(e) => setReportType(e.target.value)}>
                <option value="LAB">Lab</option>
                <option value="RADIOLOGY">Radiology</option>
              </select>
              <input
                className="input w-56"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Title (optional)"
              />
              <button className="btn-primary" onClick={upload} disabled={uploading}>
                {uploading ? "Uploading…" : "Upload"}
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-400">PDF, image, or text up to 15 MB. Encrypted at rest; auto-verified.</p>
          </>
        )}
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </div>

      {/* Uploaded reports */}
      <h2 className="mt-10 text-lg font-bold text-slate-900">Reports I&apos;ve uploaded</h2>
      {loading ? (
        <p className="mt-3 text-slate-400">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-sm text-slate-400">No uploads yet.</p>
      ) : (
        <div className="card mt-3 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-5 py-2 font-medium">Patient</th>
                <th className="px-5 py-2 font-medium">Report</th>
                <th className="px-5 py-2 font-medium">Type</th>
                <th className="px-5 py-2 font-medium">Size</th>
                <th className="px-5 py-2 font-medium">Date</th>
                <th className="px-5 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="px-5 py-3 font-medium text-slate-800">
                    {r.patientName ?? "—"}
                    {r.patientPhone && <span className="ml-1 text-xs text-slate-400">{r.patientPhone}</span>}
                  </td>
                  <td className="px-5 py-3">{r.title ?? r.originalFilename ?? "Untitled"}</td>
                  <td className="px-5 py-3">{r.reportType}</td>
                  <td className="px-5 py-3 text-slate-500">{fmtSize(r.sizeBytes)}</td>
                  <td className="px-5 py-3 text-slate-500">{new Date(r.createdAt).toLocaleDateString("en-IN")}</td>
                  <td className="px-5 py-3 text-right">
                    <a href={`/api/v1/documents/${r.id}/download`} target="_blank" className="font-medium text-brand-600">
                      View
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
