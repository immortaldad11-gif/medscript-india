"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { apiGet, apiPost, ApiError } from "@/lib/api-client";

export interface Me {
  id: string;
  role: "DOCTOR" | "PATIENT" | "SUPER_ADMIN" | "LAB_TECHNICIAN" | "RADIOLOGIST";
  phone: string;
  email: string | null;
  twoFactorEnabled: boolean;
  doctor: { clinicName: string | null; mciRegNo: string | null } | null;
  patient: { fullName: string | null } | null;
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet<Me>("/api/v1/auth/me")
      .then(setMe)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) router.replace("/login");
      })
      .finally(() => setLoading(false));
  }, [router]);

  async function logout() {
    await apiPost("/api/v1/auth/logout", {}).catch(() => {});
    router.replace("/login");
  }

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-slate-400">Loading…</div>;
  }
  if (!me) return null;

  const nav = [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/prescriptions", label: "Prescriptions" },
    ...(me.role === "DOCTOR" ? [{ href: "/prescriptions/new", label: "New Prescription" }] : []),
    ...(me.role === "PATIENT" ? [{ href: "/documents", label: "Documents" }] : []),
    ...(me.role === "PATIENT" ? [{ href: "/health-id", label: "Health ID" }] : []),
    ...(me.role === "LAB_TECHNICIAN" || me.role === "RADIOLOGIST"
      ? [{ href: "/reports", label: "Upload Reports" }]
      : []),
    ...(me.role === "DOCTOR" || me.role === "LAB_TECHNICIAN" || me.role === "RADIOLOGIST"
      ? [{ href: "/shared", label: "Shared With Me" }]
      : []),
    ...(me.role === "DOCTOR" || me.role === "SUPER_ADMIN"
      ? [{ href: "/analytics", label: "Analytics" }]
      : []),
    ...(me.role === "SUPER_ADMIN" ? [{ href: "/admin/users", label: "User Management" }] : []),
    ...(me.role === "SUPER_ADMIN" ? [{ href: "/admin/signing-keys", label: "Signing Keys" }] : []),
    ...(me.role === "SUPER_ADMIN" ? [{ href: "/admin/audit-incidents", label: "Audit & Incidents" }] : []),
  ];

  const name = me.doctor ? me.doctor.clinicName ?? "Doctor" : me.patient?.fullName ?? me.phone;

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-lg bg-brand-600" />
              <span className="font-bold text-brand-700">MedScript</span>
            </Link>
            <nav className="flex gap-1">
              {nav.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                    pathname === n.href ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  {n.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-600">
              {name} <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">{me.role}</span>
            </span>
            <button onClick={logout} className="btn-ghost py-1.5 text-sm">Log out</button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
