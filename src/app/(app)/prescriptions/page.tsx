"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiGet } from "@/lib/api-client";

interface Med {
  id: string;
  drugName: string;
  drugSchedule: string;
  dosage: string;
  unit: string;
  frequency: string;
  duration: string;
}
interface Rx {
  id: string;
  patientName: string;
  status: string;
  createdAt: string;
  diagnosisText: string | null;
  medications: Med[];
  interactions: { severity: string; drugA: string; drugB: string }[];
}

export default function PrescriptionsPage() {
  const [rows, setRows] = useState<Rx[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet<Rx[]>("/api/v1/prescriptions").then(setRows).catch(() => setRows([])).finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Prescriptions</h1>
        <Link href="/prescriptions/new" className="btn-primary">+ New</Link>
      </div>

      {loading ? (
        <p className="mt-6 text-slate-400">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="mt-6 text-slate-400">No prescriptions yet.</p>
      ) : (
        <div className="mt-6 space-y-4">
          {rows.map((r) => (
            <div key={r.id} className="card p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold text-slate-900">{r.patientName}</p>
                  <p className="text-sm text-slate-500">
                    {r.diagnosisText ?? "No diagnosis"} · {new Date(r.createdAt).toLocaleString("en-IN")}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{r.status}</span>
                  <a href={`/api/v1/prescriptions/${r.id}/pdf`} target="_blank" className="btn-ghost py-1.5 text-sm">View PDF</a>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {r.medications.map((m) => (
                  <span key={m.id} className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-700">
                    {m.drugName} {m.dosage}{m.unit} · {m.frequency} · {m.duration}
                    {m.drugSchedule !== "OTC" && <span className="ml-1 text-amber-600">[{m.drugSchedule}]</span>}
                  </span>
                ))}
              </div>
              {r.interactions.length > 0 && (
                <div className="mt-3 space-y-1">
                  {r.interactions.map((i, idx) => (
                    <p key={idx} className="text-xs text-amber-700">
                      ⚠ {i.severity}: {i.drugA} + {i.drugB}
                    </p>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
