"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiPost, ApiError } from "@/lib/api-client";

type RoleTab = "DOCTOR" | "PATIENT";

export default function RegisterPage() {
  const router = useRouter();
  const [role, setRole] = useState<RoleTab>("DOCTOR");
  const [form, setForm] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const payload = { role, ...form };
      const res = await apiPost<{ twoFactorRequired: boolean }>("/api/v1/auth/register", payload);
      // After registering, log in (handled on login page). Doctors must set up 2FA.
      router.push("/login");
    } catch (err) {
      if (err instanceof ApiError && err.data) {
        const fieldErrors = (err.data as { fieldErrors?: Record<string, string[]> }).fieldErrors;
        const first = fieldErrors ? Object.values(fieldErrors)[0]?.[0] : null;
        setError(first ?? err.message);
      } else {
        setError(err instanceof ApiError ? err.message : "Registration failed");
      }
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="card w-full max-w-lg p-8">
        <h1 className="text-2xl font-bold text-slate-900">Create your account</h1>

        <div className="mt-4 grid grid-cols-2 gap-2 rounded-lg bg-slate-100 p-1">
          {(["DOCTOR", "PATIENT"] as RoleTab[]).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRole(r)}
              className={`rounded-md py-2 text-sm font-medium ${role === r ? "bg-white text-brand-700 shadow-sm" : "text-slate-500"}`}
            >
              {r === "DOCTOR" ? "Doctor" : "Patient"}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="mt-6 space-y-4">
          <div>
            <label className="label">Full name</label>
            <input className="input" onChange={set("fullName")} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Phone (E.164)</label>
              <input className="input" onChange={set("phone")} placeholder="+919876543210" required />
            </div>
            <div>
              <label className="label">Email (optional)</label>
              <input className="input" type="email" onChange={set("email")} />
            </div>
          </div>
          <div>
            <label className="label">Password</label>
            <input className="input" type="password" onChange={set("password")} required />
            <p className="mt-1 text-xs text-slate-400">Min 8 chars, with upper, lower & a number.</p>
          </div>

          {role === "DOCTOR" ? (
            <>
              <div>
                <label className="label">MCI / NMC Registration No.</label>
                <input className="input" onChange={set("mciRegNo")} placeholder="MCI-DL-12345" required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Specialisation</label>
                  <input className="input" onChange={set("specialisation")} />
                </div>
                <div>
                  <label className="label">Qualification</label>
                  <input className="input" onChange={set("qualification")} placeholder="MBBS, MD" />
                </div>
              </div>
              <div>
                <label className="label">Clinic name</label>
                <input className="input" onChange={set("clinicName")} />
              </div>
              <div>
                <label className="label">Clinic address</label>
                <input className="input" onChange={set("clinicAddress")} />
              </div>
            </>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Gender</label>
                <input className="input" onChange={set("gender")} />
              </div>
              <div>
                <label className="label">Blood group</label>
                <input className="input" onChange={set("bloodGroup")} placeholder="O+" />
              </div>
            </div>
          )}

          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <button className="btn-primary w-full py-2.5" disabled={loading}>
            {loading ? "Creating…" : "Create account"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-500">
          Already registered? <Link href="/login" className="font-medium text-brand-600">Log in</Link>
        </p>
      </div>
    </main>
  );
}
