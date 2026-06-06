"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiPost, ApiError } from "@/lib/api-client";

export default function Setup2faPage() {
  const router = useRouter();
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [totp, setTotp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    apiPost<{ qr: string; secret: string }>("/api/v1/auth/2fa/setup", {})
      .then((res) => {
        setQr(res.qr);
        setSecret(res.secret);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) router.replace("/login");
        else setError("Could not start 2FA setup");
      });
  }, [router]);

  async function enable(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await apiPost("/api/v1/auth/2fa/enable", { totp });
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Verification failed");
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="card w-full max-w-md p-8">
        <h1 className="text-2xl font-bold text-slate-900">Set up two-factor authentication</h1>
        <p className="mt-1 text-sm text-slate-500">
          2FA is mandatory for doctors and administrators. Scan the QR with Google Authenticator or Authy.
        </p>

        {qr ? (
          <div className="mt-6 flex flex-col items-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt="2FA QR code" className="h-48 w-48" />
            {secret && <p className="mt-2 break-all text-center text-xs text-slate-400">Manual key: {secret}</p>}
          </div>
        ) : (
          <p className="mt-6 text-center text-slate-400">Loading QR…</p>
        )}

        <form onSubmit={enable} className="mt-6 space-y-4">
          <div>
            <label className="label">Enter the 6-digit code</label>
            <input className="input tracking-widest" value={totp} onChange={(e) => setTotp(e.target.value)} placeholder="123456" inputMode="numeric" required />
          </div>
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <button className="btn-primary w-full py-2.5" disabled={loading || !qr}>
            {loading ? "Verifying…" : "Enable 2FA"}
          </button>
        </form>
      </div>
    </main>
  );
}
