"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPost, ApiError } from "@/lib/api-client";

type Role = "SUPER_ADMIN" | "DOCTOR" | "PATIENT" | "LAB_TECHNICIAN" | "RADIOLOGIST";
type Kyc = "PENDING" | "VERIFIED" | "REJECTED";

interface AdminUser {
  id: string;
  role: Role;
  name: string;
  phone: string;
  email: string | null;
  mciRegNo: string | null;
  kycStatus: Kyc;
  isActive: boolean;
  twoFactorEnabled: boolean;
  locked: boolean;
  createdAt: string;
  hasDoctorProfile: boolean;
  hasPatientProfile: boolean;
}

interface UsersResponse {
  users: AdminUser[];
  total: number;
  pendingKyc: number;
  suspended: number;
}

const ROLES: Role[] = ["SUPER_ADMIN", "DOCTOR", "PATIENT", "LAB_TECHNICIAN", "RADIOLOGIST"];
const IST = (s: string) => new Date(s).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
const KYC_STYLE: Record<Kyc, string> = {
  VERIFIED: "bg-emerald-100 text-emerald-700",
  PENDING: "bg-amber-100 text-amber-700",
  REJECTED: "bg-red-100 text-red-700",
};

export default function AdminUsersPage() {
  const [data, setData] = useState<UsersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [meId, setMeId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [role, setRole] = useState<"" | Role>("");
  const [kyc, setKyc] = useState<"" | Kyc>("");
  const [status, setStatus] = useState<"all" | "active" | "inactive">("all");
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ status });
      if (role) params.set("role", role);
      if (kyc) params.set("kyc", kyc);
      if (q.trim()) params.set("q", q.trim());
      setData(await apiGet<UsersResponse>(`/api/v1/admin/users?${params}`));
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) setForbidden(true);
      else setError(e instanceof ApiError ? e.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }, [role, kyc, status, q]);

  useEffect(() => {
    apiGet<{ id: string }>("/api/v1/auth/me")
      .then((m) => setMeId(m.id))
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function mutate(userId: string, body: Record<string, unknown>) {
    setBusy(userId);
    setError(null);
    try {
      await apiPost(`/api/v1/admin/users/${userId}`, body);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Update failed");
    } finally {
      setBusy(null);
    }
  }

  function changeRole(u: AdminUser, next: Role) {
    if (next === u.role) return;
    if (!window.confirm(`Change ${u.name}'s role from ${u.role} to ${next}? This signs them out.`)) return;
    mutate(u.id, { action: "setRole", role: next });
  }

  function toggleActive(u: AdminUser) {
    const verb = u.isActive ? "Suspend" : "Reactivate";
    if (!window.confirm(`${verb} ${u.name}?`)) return;
    mutate(u.id, { action: "setActive", active: !u.isActive });
  }

  if (forbidden) {
    return (
      <div className="max-w-5xl">
        <h1 className="text-2xl font-bold text-slate-900">User Management</h1>
        <p className="mt-6 text-sm text-red-600">This area is restricted to platform administrators.</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl">
      <h1 className="text-2xl font-bold text-slate-900">User Management</h1>
      <p className="mt-1 text-sm text-slate-500">
        Administer platform accounts (Section 2.4): approve KYC, change roles, and suspend access. Every action is
        written to the immutable audit trail. Suspending or changing a role revokes the user&apos;s active sessions.
      </p>

      <div className="mt-6 flex flex-wrap items-end gap-3">
        <Field label="Role">
          <select className="input" value={role} onChange={(e) => setRole(e.target.value as "" | Role)}>
            <option value="">Any role</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </Field>
        <Field label="KYC">
          <select className="input" value={kyc} onChange={(e) => setKyc(e.target.value as "" | Kyc)}>
            <option value="">Any</option>
            <option value="PENDING">Pending</option>
            <option value="VERIFIED">Verified</option>
            <option value="REJECTED">Rejected</option>
          </select>
        </Field>
        <Field label="Status">
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="inactive">Suspended</option>
          </select>
        </Field>
        <Field label="Search (name, phone, email, MCI)">
          <input
            className="input w-72"
            placeholder="e.g. Asha or +9190…"
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
          <span className="rounded-md bg-slate-100 px-2 py-1 text-slate-600">{data.total} total</span>
          {data.pendingKyc > 0 ? (
            <span className="rounded-md bg-amber-100 px-2 py-1 text-amber-700">{data.pendingKyc} pending KYC</span>
          ) : null}
          {data.suspended > 0 ? (
            <span className="rounded-md bg-red-100 px-2 py-1 text-red-700">{data.suspended} suspended</span>
          ) : null}
        </div>
      )}

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {loading ? (
        <p className="mt-6 text-slate-400">Loading…</p>
      ) : data && data.users.length === 0 ? (
        <p className="mt-6 text-sm text-slate-400">No users match.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="py-2 pr-4 font-medium">User</th>
                <th className="py-2 pr-4 font-medium">Role</th>
                <th className="py-2 pr-4 font-medium">KYC</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium">2FA</th>
                <th className="py-2 pr-4 font-medium">Created (IST)</th>
              </tr>
            </thead>
            <tbody>
              {data?.users.map((u) => {
                const isSelf = u.id === meId;
                const rowBusy = busy === u.id;
                return (
                  <tr key={u.id} className="border-b border-slate-100 align-top">
                    <td className="py-3 pr-4">
                      <div className="font-medium text-slate-900">
                        {u.name}
                        {isSelf ? <span className="ml-1 text-xs text-slate-400">(you)</span> : null}
                      </div>
                      <div className="text-xs text-slate-500">{u.phone}</div>
                      {u.email ? <div className="text-xs text-slate-400">{u.email}</div> : null}
                      {u.mciRegNo ? <div className="text-xs text-slate-400">MCI {u.mciRegNo}</div> : null}
                    </td>
                    <td className="py-3 pr-4">
                      <select
                        className="input py-1 text-xs"
                        value={u.role}
                        disabled={isSelf || rowBusy}
                        onChange={(e) => changeRole(u, e.target.value as Role)}
                      >
                        {ROLES.map((r) => (
                          <option
                            key={r}
                            value={r}
                            disabled={
                              (r === "DOCTOR" && !u.hasDoctorProfile && u.role !== "DOCTOR") ||
                              (r === "PATIENT" && !u.hasPatientProfile && u.role !== "PATIENT")
                            }
                          >
                            {r}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-3 pr-4">
                      <div className="flex items-center gap-2">
                        <span className={`inline-flex h-5 items-center rounded-full px-2 text-xs font-semibold ${KYC_STYLE[u.kycStatus]}`}>
                          {u.kycStatus}
                        </span>
                        <select
                          className="input py-1 text-xs"
                          value={u.kycStatus}
                          disabled={rowBusy}
                          onChange={(e) => mutate(u.id, { action: "setKyc", kyc: e.target.value as Kyc })}
                        >
                          <option value="PENDING">Pending</option>
                          <option value="VERIFIED">Verified</option>
                          <option value="REJECTED">Rejected</option>
                        </select>
                      </div>
                    </td>
                    <td className="py-3 pr-4">
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-flex h-5 items-center rounded-full px-2 text-xs font-semibold ${
                            u.isActive ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                          }`}
                        >
                          {u.isActive ? "Active" : "Suspended"}
                        </span>
                        {u.locked ? <span className="text-xs text-amber-600">locked</span> : null}
                        <button
                          className="btn-ghost text-xs"
                          disabled={rowBusy || (isSelf && u.isActive)}
                          title={isSelf && u.isActive ? "You cannot suspend your own account" : undefined}
                          onClick={() => toggleActive(u)}
                        >
                          {u.isActive ? "Suspend" : "Reactivate"}
                        </button>
                      </div>
                    </td>
                    <td className="py-3 pr-4 text-slate-600">{u.twoFactorEnabled ? "On" : "Off"}</td>
                    <td className="py-3 pr-4 text-slate-500">{IST(u.createdAt)}</td>
                  </tr>
                );
              })}
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
