"use client";

import { useEffect, useState } from "react";
import { apiGet, ApiError } from "@/lib/api-client";

interface Shared {
  id: string;
  patientName: string;
  patientPhone: string | null;
  purpose: string;
  dataTypes: string[];
  reportCount: number;
  grantedAt: string;
  expiresAt: string;
}

interface AccessDoc {
  id: string;
  title: string | null;
  reportType: string;
  originalFilename: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  structuredData: unknown;
  createdAt: string;
  downloadUrl: string;
}

interface AccessResult {
  consentId: string;
  expiresAt: string;
  documents: AccessDoc[];
}

export default function SharedPage() {
  const [rows, setRows] = useState<Shared[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [access, setAccess] = useState<AccessResult | null>(null);
  const [accessLoading, setAccessLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<Shared[]>("/api/v1/consent/shared-with-me")
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, []);

  async function openConsent(id: string) {
    setOpenId(id);
    setAccess(null);
    setError(null);
    setAccessLoading(true);
    try {
      const res = await apiGet<AccessResult>(`/api/v1/consent/${id}/access`);
      setAccess(res);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setAccessLoading(false);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900">Shared With Me</h1>
      <p className="mt-1 text-sm text-slate-500">Records patients have granted you time-scoped access to.</p>

      {loading ? (
        <p className="mt-6 text-slate-400">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="mt-6 text-slate-400">No records have been shared with you.</p>
      ) : (
        <div className="mt-6 space-y-2">
          {rows.map((r) => (
            <div key={r.id} className="card p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-slate-900">{r.patientName}</p>
                  <p className="text-xs text-slate-500">
                    {r.reportCount} record(s) · {r.purpose} · expires{" "}
                    {new Date(r.expiresAt).toLocaleString("en-IN")}
                  </p>
                </div>
                <button className="btn-primary py-1.5 text-sm" onClick={() => openConsent(r.id)}>
                  {openId === r.id ? "Refresh" : "Open"}
                </button>
              </div>

              {openId === r.id && (
                <div className="mt-4 border-t border-slate-100 pt-4">
                  {accessLoading ? (
                    <p className="text-sm text-slate-400">Issuing access…</p>
                  ) : error ? (
                    <p className="text-sm text-red-600">{error}</p>
                  ) : access ? (
                    <div className="space-y-2">
                      {access.documents.map((d) => (
                        <div key={d.id} className="flex items-center justify-between rounded-md bg-slate-50 p-3">
                          <div>
                            <p className="text-sm font-medium text-slate-800">
                              {d.title ?? d.originalFilename ?? "Untitled"}
                            </p>
                            <p className="text-xs text-slate-500">
                              {d.reportType} · {new Date(d.createdAt).toLocaleString("en-IN")}
                            </p>
                          </div>
                          <a href={d.downloadUrl} target="_blank" className="btn-ghost py-1 text-sm">
                            View
                          </a>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
