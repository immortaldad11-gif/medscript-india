"use client";

import { useEffect, useState } from "react";
import { apiGet, apiPost, apiDelete, ApiError } from "@/lib/api-client";

interface AbhaStatus {
  linked: boolean;
  abhaAddress: string | null;
  maskedNumber: string | null;
  linkedAt: string | null;
  kycStatus?: string;
}

interface InitResult {
  txnId: string;
  maskedMobile: string;
  expiresInSec: number;
  devOtp?: string;
}

type Mode = "number" | "address";

export default function HealthIdPage() {
  const [status, setStatus] = useState<AbhaStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [mode, setMode] = useState<Mode>("number");
  const [abhaNumber, setAbhaNumber] = useState("");
  const [abhaAddress, setAbhaAddress] = useState("");
  const [sending, setSending] = useState(false);

  const [challenge, setChallenge] = useState<InitResult | null>(null);
  const [otp, setOtp] = useState("");
  const [verifying, setVerifying] = useState(false);

  async function load() {
    setLoading(true);
    const s = await apiGet<AbhaStatus>("/api/v1/abha").catch(() => null);
    setStatus(s);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function sendOtp() {
    setError(null);
    setSending(true);
    try {
      const payload = mode === "number" ? { abhaNumber: abhaNumber.trim() } : { abhaAddress: abhaAddress.trim() };
      const res = await apiPost<InitResult>("/api/v1/abha/link/init", payload);
      setChallenge(res);
      if (res.devOtp) setOtp(res.devOtp);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to send OTP");
    } finally {
      setSending(false);
    }
  }

  async function verifyOtp() {
    if (!challenge) return;
    setError(null);
    setVerifying(true);
    try {
      await apiPost("/api/v1/abha/link/verify", { txnId: challenge.txnId, otp: otp.trim() });
      setChallenge(null);
      setOtp("");
      setAbhaNumber("");
      setAbhaAddress("");
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Verification failed");
    } finally {
      setVerifying(false);
    }
  }

  async function unlink() {
    await apiDelete("/api/v1/abha").catch(() => {});
    setChallenge(null);
    await load();
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold text-slate-900">Health ID (ABHA)</h1>
      <p className="mt-1 text-sm text-slate-500">
        Link your Ayushman Bharat Health Account to carry a portable, consent-gated health identity across providers.
      </p>

      {loading ? (
        <p className="mt-6 text-slate-400">Loading…</p>
      ) : status?.linked ? (
        <div className="card mt-6 p-6">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-6 items-center rounded-full bg-emerald-100 px-2 text-xs font-semibold text-emerald-700">
              ✓ Linked
            </span>
            {status.kycStatus === "VERIFIED" && (
              <span className="inline-flex h-6 items-center rounded-full bg-brand-50 px-2 text-xs font-semibold text-brand-700">
                KYC verified
              </span>
            )}
          </div>
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">ABHA address</dt>
              <dd className="font-medium text-slate-900">{status.abhaAddress}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">ABHA number</dt>
              <dd className="font-mono text-slate-900">{status.maskedNumber}</dd>
            </div>
            {status.linkedAt && (
              <div className="flex justify-between">
                <dt className="text-slate-500">Linked on</dt>
                <dd className="text-slate-900">{new Date(status.linkedAt).toLocaleString("en-IN")}</dd>
              </div>
            )}
          </dl>
          <button className="btn-ghost mt-5 text-sm text-red-600" onClick={unlink}>
            Unlink ABHA
          </button>
        </div>
      ) : (
        <div className="card mt-6 p-6">
          {!challenge ? (
            <>
              <div className="flex gap-2">
                <button
                  className={`rounded-md px-3 py-1.5 text-sm font-medium ${mode === "number" ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100"}`}
                  onClick={() => setMode("number")}
                >
                  ABHA number
                </button>
                <button
                  className={`rounded-md px-3 py-1.5 text-sm font-medium ${mode === "address" ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100"}`}
                  onClick={() => setMode("address")}
                >
                  ABHA address
                </button>
              </div>
              <div className="mt-4">
                {mode === "number" ? (
                  <>
                    <label className="label">14-digit ABHA number</label>
                    <input
                      className="input mt-1"
                      value={abhaNumber}
                      onChange={(e) => setAbhaNumber(e.target.value)}
                      placeholder="12-3456-7890-1234"
                    />
                  </>
                ) : (
                  <>
                    <label className="label">ABHA address</label>
                    <input
                      className="input mt-1"
                      value={abhaAddress}
                      onChange={(e) => setAbhaAddress(e.target.value)}
                      placeholder="yourname@abdm"
                    />
                  </>
                )}
              </div>
              <button className="btn-primary mt-4" onClick={sendOtp} disabled={sending}>
                {sending ? "Sending OTP…" : "Send OTP"}
              </button>
            </>
          ) : (
            <>
              <p className="text-sm text-slate-600">
                An OTP was sent to the mobile linked to your ABHA (<span className="font-mono">{challenge.maskedMobile}</span>).
              </p>
              {challenge.devOtp && (
                <p className="mt-1 text-xs text-amber-600">Dev mode: OTP is {challenge.devOtp} (prefilled).</p>
              )}
              <label className="label mt-4">Enter OTP</label>
              <input
                className="input mt-1 w-40 tracking-widest"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                placeholder="••••••"
                inputMode="numeric"
              />
              <div className="mt-4 flex gap-2">
                <button className="btn-primary" onClick={verifyOtp} disabled={verifying}>
                  {verifying ? "Verifying…" : "Verify & link"}
                </button>
                <button className="btn-ghost" onClick={() => setChallenge(null)} disabled={verifying}>
                  Back
                </button>
              </div>
            </>
          )}
          {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
        </div>
      )}

      <p className="mt-6 text-xs text-slate-400">
        Your ABHA number is encrypted at rest. MedScript never stores your Aadhaar. Linking is processed through the ABDM
        Gateway under your explicit consent (DPDPA 2023).
      </p>
    </div>
  );
}
