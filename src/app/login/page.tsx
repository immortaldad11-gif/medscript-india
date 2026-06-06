"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiPost, ApiError } from "@/lib/api-client";

interface LoginResult {
  id?: string;
  role?: string;
  twoFactorRequired?: boolean;
  twoFactorSetupRequired?: boolean;
}

export default function LoginPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [needs2fa, setNeeds2fa] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await apiPost<LoginResult>("/api/v1/auth/login", {
        identifier,
        password,
        totp: totp || undefined,
      });
      if (res.twoFactorRequired) {
        setNeeds2fa(true);
        setLoading(false);
        return;
      }
      if (res.twoFactorSetupRequired) {
        router.push("/setup-2fa");
        return;
      }
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login failed");
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="card w-full max-w-md p-8">
        <h1 className="text-2xl font-bold text-slate-900">Log in to MedScript</h1>
        <p className="mt-1 text-sm text-slate-500">Doctors, patients & administrators</p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          <div>
            <label className="label">Phone or Email</label>
            <input className="input" value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="+919876543210" required />
          </div>
          <div>
            <label className="label">Password</label>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          {needs2fa && (
            <div>
              <label className="label">2FA Code</label>
              <input className="input tracking-widest" value={totp} onChange={(e) => setTotp(e.target.value)} placeholder="123456" inputMode="numeric" autoFocus />
            </div>
          )}
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <button className="btn-primary w-full py-2.5" disabled={loading}>
            {loading ? "Signing in…" : needs2fa ? "Verify & continue" : "Log in"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-500">
          No account? <Link href="/register" className="font-medium text-brand-600">Register</Link>
        </p>
        <div className="mt-4 rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
          <p className="font-medium text-slate-600">Demo accounts (password: Password123!)</p>
          <p>Doctor: doctor@medscript.in · Patient: patient@medscript.in</p>
        </div>
      </div>
    </main>
  );
}
