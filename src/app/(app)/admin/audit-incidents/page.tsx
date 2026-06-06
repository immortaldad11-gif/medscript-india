"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPost, ApiError } from "@/lib/api-client";

type Severity = "WARNING" | "ERROR" | "CRITICAL";

interface Incident {
  id: string;
  requestId: string | null;
  severity: Severity;
  source: string;
  errorCode: string | null;
  httpStatus: number | null;
  message: string;
  detail: string | null;
  method: string | null;
  path: string | null;
  userId: string | null;
  ipAddress: string | null;
  resolved: boolean;
  resolvedAt: string | null;
  createdAt: string;
}

interface IncidentResponse {
  incidents: Incident[];
  openTotal: number;
  openBySeverity: Partial<Record<Severity, number>>;
}

interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  timestamp: string;
  ipAddress: string | null;
  metadata: unknown;
  actor: { id: string; role: string; name: string } | null;
}

interface AuditResponse {
  logs: AuditEntry[];
  actions: string[];
}

const IST = (s: string) => new Date(s).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

export default function AuditIncidentsPage() {
  const [tab, setTab] = useState<"incidents" | "audit">("incidents");
  const [forbidden, setForbidden] = useState(false);

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-bold text-slate-900">Audit &amp; Incidents</h1>
      <p className="mt-1 text-sm text-slate-500">
        Operational visibility for platform administrators — the immutable accountability trail (DPDPA 2023) and the
        server-side incident log. When a user hits an error they receive a <span className="font-mono">request_id</span>;
        search it here to find the exact failure.
      </p>

      {forbidden ? (
        <p className="mt-6 text-sm text-red-600">This area is restricted to platform administrators.</p>
      ) : (
        <>
          <div className="mt-6 flex gap-1 border-b border-slate-200">
            <TabButton active={tab === "incidents"} onClick={() => setTab("incidents")} label="Incidents" />
            <TabButton active={tab === "audit"} onClick={() => setTab("audit")} label="Audit log" />
          </div>
          <div className="mt-6">
            {tab === "incidents" ? (
              <IncidentsTab onForbidden={() => setForbidden(true)} />
            ) : (
              <AuditTab onForbidden={() => setForbidden(true)} />
            )}
          </div>
        </>
      )}
    </div>
  );
}

function TabButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${
        active ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-700"
      }`}
    >
      {label}
    </button>
  );
}

// --- Incidents -----------------------------------------------------------------------

const SEV_STYLE: Record<Severity, string> = {
  WARNING: "bg-amber-100 text-amber-700",
  ERROR: "bg-red-100 text-red-700",
  CRITICAL: "bg-red-200 text-red-900",
};

function IncidentsTab({ onForbidden }: { onForbidden: () => void }) {
  const [data, setData] = useState<IncidentResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"open" | "resolved" | "all">("open");
  const [severity, setSeverity] = useState<"" | Severity>("");
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ status });
      if (severity) params.set("severity", severity);
      if (q.trim()) params.set("q", q.trim());
      setData(await apiGet<IncidentResponse>(`/api/v1/admin/incidents?${params}`));
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) onForbidden();
      else setError(e instanceof ApiError ? e.message : "Failed to load incidents");
    } finally {
      setLoading(false);
    }
  }, [status, severity, q, onForbidden]);

  useEffect(() => {
    load();
  }, [load]);

  async function toggleResolve(inc: Incident) {
    try {
      await apiPost(`/api/v1/admin/incidents/${inc.id}/resolve`, { resolved: !inc.resolved });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Update failed");
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Status">
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="open">Open</option>
            <option value="resolved">Resolved</option>
            <option value="all">All</option>
          </select>
        </Field>
        <Field label="Severity">
          <select className="input" value={severity} onChange={(e) => setSeverity(e.target.value as typeof severity)}>
            <option value="">Any</option>
            <option value="WARNING">Warning</option>
            <option value="ERROR">Error</option>
            <option value="CRITICAL">Critical</option>
          </select>
        </Field>
        <Field label="Search (request_id, message, source)">
          <input
            className="input w-72"
            placeholder="e.g. a1b2c3d4"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && load()}
          />
        </Field>
        <button className="btn-ghost text-sm" onClick={load}>
          Refresh
        </button>
      </div>

      {data && (
        <div className="mt-4 flex gap-2 text-sm">
          <span className="rounded-md bg-slate-100 px-2 py-1 text-slate-600">{data.openTotal} open</span>
          {(["CRITICAL", "ERROR", "WARNING"] as Severity[]).map((s) =>
            data.openBySeverity[s] ? (
              <span key={s} className={`rounded-md px-2 py-1 ${SEV_STYLE[s]}`}>
                {data.openBySeverity[s]} {s.toLowerCase()}
              </span>
            ) : null,
          )}
        </div>
      )}

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {loading ? (
        <p className="mt-6 text-slate-400">Loading…</p>
      ) : data && data.incidents.length === 0 ? (
        <p className="mt-6 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          No incidents match — nothing is on fire.
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          {data?.incidents.map((inc) => (
            <div key={inc.id} className="card p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`inline-flex h-5 items-center rounded-full px-2 text-xs font-semibold ${SEV_STYLE[inc.severity]}`}>
                      {inc.severity}
                    </span>
                    <span className="font-mono text-xs text-slate-500">{inc.source}</span>
                    {inc.httpStatus ? <span className="text-xs text-slate-400">HTTP {inc.httpStatus}</span> : null}
                    {inc.resolved ? (
                      <span className="inline-flex h-5 items-center rounded-full bg-slate-100 px-2 text-xs font-semibold text-slate-500">
                        Resolved
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 font-medium text-slate-900">{inc.message}</p>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-500">
                    {inc.requestId ? (
                      <span>
                        request_id <span className="font-mono text-slate-700">{inc.requestId}</span>
                      </span>
                    ) : null}
                    {inc.method && inc.path ? (
                      <span className="font-mono">
                        {inc.method} {inc.path}
                      </span>
                    ) : null}
                    <span>{IST(inc.createdAt)}</span>
                    {inc.ipAddress ? <span>IP {inc.ipAddress}</span> : null}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <button className="btn-ghost text-xs" onClick={() => toggleResolve(inc)}>
                    {inc.resolved ? "Reopen" : "Mark resolved"}
                  </button>
                  {inc.detail ? (
                    <button
                      className="text-xs text-brand-600"
                      onClick={() => setExpanded(expanded === inc.id ? null : inc.id)}
                    >
                      {expanded === inc.id ? "Hide detail" : "View detail"}
                    </button>
                  ) : null}
                </div>
              </div>
              {expanded === inc.id && inc.detail ? (
                <pre className="mt-3 max-h-72 overflow-auto rounded-md bg-slate-900 p-3 text-xs leading-relaxed text-slate-100">
                  {inc.detail}
                </pre>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Audit log -----------------------------------------------------------------------

function AuditTab({ onForbidden }: { onForbidden: () => void }) {
  const [data, setData] = useState<AuditResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState("");
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (action) params.set("action", action);
      if (q.trim()) params.set("q", q.trim());
      setData(await apiGet<AuditResponse>(`/api/v1/admin/audit?${params}`));
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) onForbidden();
      else setError(e instanceof ApiError ? e.message : "Failed to load audit log");
    } finally {
      setLoading(false);
    }
  }, [action, q, onForbidden]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Action">
          <select className="input" value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="">Any action</option>
            {data?.actions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Search (entity id, actor id)">
          <input
            className="input w-72"
            placeholder="entity or user id"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && load()}
          />
        </Field>
        <button className="btn-ghost text-sm" onClick={load}>
          Refresh
        </button>
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {loading ? (
        <p className="mt-6 text-slate-400">Loading…</p>
      ) : data && data.logs.length === 0 ? (
        <p className="mt-6 text-sm text-slate-400">No audit entries match.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="py-2 pr-4 font-medium">When (IST)</th>
                <th className="py-2 pr-4 font-medium">Action</th>
                <th className="py-2 pr-4 font-medium">Actor</th>
                <th className="py-2 pr-4 font-medium">Entity</th>
                <th className="py-2 pr-4 font-medium">IP</th>
              </tr>
            </thead>
            <tbody>
              {data?.logs.map((l) => (
                <tr key={l.id} className="border-b border-slate-100 align-top">
                  <td className="py-2 pr-4 text-slate-500">{IST(l.timestamp)}</td>
                  <td className="py-2 pr-4 font-mono text-slate-800">{l.action}</td>
                  <td className="py-2 pr-4 text-slate-700">
                    {l.actor ? (
                      <>
                        {l.actor.name}{" "}
                        <span className="rounded bg-slate-100 px-1 py-0.5 text-xs text-slate-500">{l.actor.role}</span>
                      </>
                    ) : (
                      <span className="text-slate-400">system / unknown</span>
                    )}
                  </td>
                  <td className="py-2 pr-4 text-slate-600">
                    <span className="text-slate-500">{l.entityType}</span>
                    {l.entityId ? <span className="ml-1 font-mono text-xs text-slate-400">{l.entityId}</span> : null}
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs text-slate-400">{l.ipAddress ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
      {label}
      {children}
    </label>
  );
}
