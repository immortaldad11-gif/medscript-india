"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiGet } from "@/lib/api-client";

interface Rx {
  id: string;
  patientName: string;
  status: string;
  createdAt: string;
  medications: { id: string }[];
  interactions: { severity: string }[];
}

export default function DashboardPage() {
  const [rows, setRows] = useState<Rx[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet<Rx[]>("/api/v1/prescriptions").then(setRows).catch(() => setRows([])).finally(() => setLoading(false));
  }, []);

  const total = rows.length;
  const delivered = rows.filter((r) => r.status === "DELIVERED").length;
  const flagged = rows.filter((r) => r.interactions.length > 0).length;

  const stats = [
    { label: "Prescriptions", value: total },
    { label: "Delivered", value: delivered },
    { label: "With interaction flags", value: flagged },
  ];

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <Link href="/prescriptions/new" className="btn-primary">+ New Prescription</Link>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        {stats.map((s) => (
          <div key={s.label} className="card p-5">
            <p className="text-sm text-slate-500">{s.label}</p>
            <p className="mt-1 text-3xl font-bold text-brand-700">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="card mt-8 overflow-hidden">
        <div className="border-b border-slate-200 px-5 py-3 font-semibold text-slate-800">Recent prescriptions</div>
        {loading ? (
          <div className="p-6 text-slate-400">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-slate-400">No prescriptions yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-5 py-2 font-medium">Patient</th>
                <th className="px-5 py-2 font-medium">Drugs</th>
                <th className="px-5 py-2 font-medium">Flags</th>
                <th className="px-5 py-2 font-medium">Status</th>
                <th className="px-5 py-2 font-medium">Date</th>
                <th className="px-5 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="px-5 py-3 font-medium text-slate-800">{r.patientName}</td>
                  <td className="px-5 py-3">{r.medications.length}</td>
                  <td className="px-5 py-3">
                    {r.interactions.length > 0 ? (
                      <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">{r.interactions.length}</span>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{r.status}</span>
                  </td>
                  <td className="px-5 py-3 text-slate-500">{new Date(r.createdAt).toLocaleDateString("en-IN")}</td>
                  <td className="px-5 py-3 text-right">
                    <a href={`/api/v1/prescriptions/${r.id}/pdf`} target="_blank" className="font-medium text-brand-600">PDF</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
