"use client";

import { useEffect, useState } from "react";
import { apiGet } from "@/lib/api-client";

interface Analytics {
  scope: "platform" | "doctor";
  summary: {
    totalPrescriptions: number;
    signed: number;
    delivered: number;
    distinctPatients: number;
    flaggedPrescriptions: number;
    interactionOverrides: number;
  };
  prescriptionsByDay: { date: string; count: number }[];
  topDrugs: { drugName: string; count: number }[];
  scheduleDistribution: { schedule: string; count: number }[];
  interactionsBySeverity: { severity: string; count: number }[];
  platform: { documents: number; activeConsents: number; doctors: number; patients: number } | null;
}

const SEVERITY_COLOR: Record<string, string> = {
  CONTRAINDICATED: "bg-red-500",
  MAJOR: "bg-orange-500",
  MODERATE: "bg-amber-400",
  MINOR: "bg-slate-300",
};

function Bars({ data, color }: { data: { label: string; value: number }[]; color?: (l: string) => string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  if (data.length === 0) return <p className="text-sm text-slate-400">No data yet.</p>;
  return (
    <div className="space-y-2">
      {data.map((d) => (
        <div key={d.label} className="flex items-center gap-3">
          <span className="w-32 shrink-0 truncate text-sm text-slate-600">{d.label}</span>
          <div className="h-5 flex-1 rounded bg-slate-100">
            <div
              className={`h-5 rounded ${color ? color(d.label) : "bg-brand-500"}`}
              style={{ width: `${Math.max(4, (d.value / max) * 100)}%` }}
            />
          </div>
          <span className="w-8 shrink-0 text-right text-sm font-medium text-slate-700">{d.value}</span>
        </div>
      ))}
    </div>
  );
}

export default function AnalyticsPage() {
  const [a, setA] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet<Analytics>("/api/v1/analytics").then(setA).catch(() => setA(null)).finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-slate-400">Loading…</p>;
  if (!a) return <p className="text-slate-400">No analytics available.</p>;

  const cards = [
    { label: "Prescriptions", value: a.summary.totalPrescriptions },
    { label: "Signed", value: a.summary.signed },
    { label: "Delivered", value: a.summary.delivered },
    { label: "Patients", value: a.summary.distinctPatients },
    { label: "Flagged", value: a.summary.flaggedPrescriptions },
    { label: "Overrides", value: a.summary.interactionOverrides },
  ];

  const dayMax = Math.max(1, ...a.prescriptionsByDay.map((d) => d.count));

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Analytics</h1>
        <span className="rounded bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">
          {a.scope === "platform" ? "Platform-wide" : "My practice"}
        </span>
      </div>

      {/* Summary cards */}
      <div className="mt-6 grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {cards.map((c) => (
          <div key={c.label} className="card p-4">
            <p className="text-xs text-slate-500">{c.label}</p>
            <p className="mt-1 text-2xl font-bold text-brand-700">{c.value}</p>
          </div>
        ))}
      </div>

      {a.platform && (
        <div className="mt-4 grid gap-4 sm:grid-cols-4">
          {[
            { label: "Documents", value: a.platform.documents },
            { label: "Active consents", value: a.platform.activeConsents },
            { label: "Doctors", value: a.platform.doctors },
            { label: "Patients (total)", value: a.platform.patients },
          ].map((c) => (
            <div key={c.label} className="card p-4">
              <p className="text-xs text-slate-500">{c.label}</p>
              <p className="mt-1 text-2xl font-bold text-slate-800">{c.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Prescriptions over time */}
      <div className="card mt-8 p-5">
        <p className="font-semibold text-slate-800">Prescriptions — last 14 days</p>
        <div className="mt-4 flex h-40 items-end gap-1">
          {a.prescriptionsByDay.map((d) => (
            <div key={d.date} className="group flex flex-1 flex-col items-center justify-end">
              <span className="mb-1 text-xs text-slate-400 opacity-0 group-hover:opacity-100">{d.count}</span>
              <div
                className="w-full rounded-t bg-brand-500"
                style={{ height: `${(d.count / dayMax) * 100}%`, minHeight: d.count > 0 ? 4 : 0 }}
              />
              <span className="mt-1 text-[10px] text-slate-400">{d.date.slice(5)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="card p-5">
          <p className="font-semibold text-slate-800">Top prescribed drugs</p>
          <div className="mt-4">
            <Bars data={a.topDrugs.map((d) => ({ label: d.drugName, value: d.count }))} />
          </div>
        </div>

        <div className="card p-5">
          <p className="font-semibold text-slate-800">Drug schedule mix</p>
          <div className="mt-4">
            <Bars data={a.scheduleDistribution.map((d) => ({ label: d.schedule, value: d.count }))} />
          </div>
        </div>
      </div>

      <div className="card mt-6 p-5">
        <p className="font-semibold text-slate-800">Interaction flags by severity</p>
        <div className="mt-4">
          <Bars
            data={a.interactionsBySeverity.map((d) => ({ label: d.severity, value: d.count }))}
            color={(l) => SEVERITY_COLOR[l] ?? "bg-brand-500"}
          />
        </div>
      </div>
    </div>
  );
}
