"use client";

import { useEffect, useState, useRef } from "react";
import { apiGet, apiPost, apiDelete, ApiError } from "@/lib/api-client";

interface Doc {
  id: string;
  title: string | null;
  reportType: string;
  originalFilename: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  isVerified: boolean;
  ocrStatus?: string;
  createdAt: string;
}

interface Consent {
  id: string;
  granteeName: string;
  granteeClinic: string | null;
  granteeMciRegNo: string | null;
  purpose: string;
  dataTypes: string[];
  reportCount: number;
  status: string;
  grantedAt: string;
  expiresAt: string;
}

const TTL_OPTIONS = [
  { label: "1 hour", value: 3600 },
  { label: "24 hours", value: 24 * 3600 },
  { label: "7 days", value: 7 * 24 * 3600 },
  { label: "30 days", value: 30 * 24 * 3600 },
];

function fmtSize(n: number | null): string {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function DocumentsPage() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [consents, setConsents] = useState<Consent[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [reportType, setReportType] = useState("LAB");
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Share dialog state.
  const [shareOpen, setShareOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mciRegNo, setMciRegNo] = useState("");
  const [purpose, setPurpose] = useState("Consultation");
  const [ttl, setTtl] = useState(24 * 3600);
  const [sharing, setSharing] = useState(false);

  async function load() {
    setLoading(true);
    const [d, c] = await Promise.all([
      apiGet<Doc[]>("/api/v1/documents").catch(() => []),
      apiGet<Consent[]>("/api/v1/consent").catch(() => []),
    ]);
    setDocs(d);
    setConsents(c);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function upload() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("reportType", reportType);
      const res = await fetch("/api/v1/documents/upload", {
        method: "POST",
        body: form,
        credentials: "include",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.message ?? "Upload failed");
      if (fileRef.current) fileRef.current.value = "";
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function openShare() {
    setError(null);
    setMciRegNo("");
    setPurpose("Consultation");
    setTtl(24 * 3600);
    setShareOpen(true);
  }

  async function share() {
    if (selected.size === 0) {
      setError("Select at least one document to share");
      return;
    }
    if (!mciRegNo.trim()) {
      setError("Enter the doctor's MCI/NMC registration number");
      return;
    }
    setSharing(true);
    setError(null);
    try {
      await apiPost("/api/v1/consent", {
        granteeMciRegNo: mciRegNo.trim(),
        reportIds: [...selected],
        purpose: purpose.trim() || "Consultation",
        ttlSeconds: ttl,
      });
      setShareOpen(false);
      setSelected(new Set());
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setSharing(false);
    }
  }

  async function revoke(id: string) {
    await apiDelete(`/api/v1/consent/${id}`).catch(() => {});
    await load();
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">My Documents</h1>
        <button className="btn-primary" onClick={openShare} disabled={selected.size === 0}>
          Share {selected.size > 0 ? `(${selected.size})` : ""}
        </button>
      </div>

      {/* Upload */}
      <div className="card mt-6 p-5">
        <p className="label">Upload a medical report</p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <input ref={fileRef} type="file" className="text-sm" accept=".pdf,.png,.jpg,.jpeg,.txt" />
          <select className="input w-auto" value={reportType} onChange={(e) => setReportType(e.target.value)}>
            <option value="LAB">Lab</option>
            <option value="RADIOLOGY">Radiology</option>
            <option value="PRESCRIPTION">Prescription</option>
          </select>
          <button className="btn-primary" onClick={upload} disabled={uploading}>
            {uploading ? "Uploading…" : "Upload"}
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-400">PDF, image, or text up to 15 MB. Files are encrypted at rest.</p>
      </div>

      {error && !shareOpen && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {/* Document list */}
      {loading ? (
        <p className="mt-6 text-slate-400">Loading…</p>
      ) : docs.length === 0 ? (
        <p className="mt-6 text-slate-400">No documents yet.</p>
      ) : (
        <div className="mt-6 space-y-2">
          {docs.map((d) => (
            <label key={d.id} className="card flex cursor-pointer items-center gap-3 p-4">
              <input type="checkbox" checked={selected.has(d.id)} onChange={() => toggle(d.id)} />
              <div className="flex-1">
                <p className="font-medium text-slate-900">{d.title ?? d.originalFilename ?? "Untitled"}</p>
                <p className="text-xs text-slate-500">
                  {d.reportType} · {fmtSize(d.sizeBytes)} · {new Date(d.createdAt).toLocaleString("en-IN")}
                  {d.isVerified && <span className="ml-1 text-emerald-600">· verified</span>}
                  {d.ocrStatus === "PENDING" && <span className="ml-1 text-amber-600">· processing…</span>}
                  {d.ocrStatus === "FAILED" && <span className="ml-1 text-red-500">· OCR failed</span>}
                </p>
              </div>
              <a
                href={`/api/v1/documents/${d.id}/download`}
                target="_blank"
                className="btn-ghost py-1.5 text-sm"
                onClick={(e) => e.stopPropagation()}
              >
                View
              </a>
            </label>
          ))}
        </div>
      )}

      {/* Active shares */}
      <h2 className="mt-10 text-lg font-bold text-slate-900">Who can see my records</h2>
      {consents.length === 0 ? (
        <p className="mt-3 text-sm text-slate-400">You haven&apos;t shared any records.</p>
      ) : (
        <div className="mt-3 space-y-2">
          {consents.map((c) => {
            const expired = new Date(c.expiresAt) < new Date();
            const live = c.status === "ACTIVE" && !expired;
            return (
              <div key={c.id} className="card flex items-center justify-between p-4">
                <div>
                  <p className="font-medium text-slate-900">
                    {c.granteeName}
                    {c.granteeMciRegNo && <span className="ml-1 text-xs text-slate-400">({c.granteeMciRegNo})</span>}
                  </p>
                  <p className="text-xs text-slate-500">
                    {c.reportCount} record(s) · {c.purpose} ·{" "}
                    {live ? `expires ${new Date(c.expiresAt).toLocaleString("en-IN")}` : c.status.toLowerCase()}
                  </p>
                </div>
                {live && (
                  <button className="btn-ghost py-1.5 text-sm text-red-600" onClick={() => revoke(c.id)}>
                    Revoke
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Share dialog */}
      {shareOpen && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/30 p-4">
          <div className="card w-full max-w-md p-6">
            <h3 className="text-lg font-bold text-slate-900">Share {selected.size} document(s)</h3>
            <div className="mt-4 space-y-3">
              <div>
                <label className="label">Doctor&apos;s MCI/NMC registration number</label>
                <input
                  className="input mt-1"
                  value={mciRegNo}
                  onChange={(e) => setMciRegNo(e.target.value)}
                  placeholder="MCI-DL-12345"
                />
              </div>
              <div>
                <label className="label">Purpose</label>
                <input className="input mt-1" value={purpose} onChange={(e) => setPurpose(e.target.value)} />
              </div>
              <div>
                <label className="label">Access expires after</label>
                <select className="input mt-1" value={ttl} onChange={(e) => setTtl(Number(e.target.value))}>
                  {TTL_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setShareOpen(false)} disabled={sharing}>
                Cancel
              </button>
              <button className="btn-primary" onClick={share} disabled={sharing}>
                {sharing ? "Sharing…" : "Grant access"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
