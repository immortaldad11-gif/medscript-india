"use client";

import { useEffect, useState } from "react";
import { apiGet, apiPost, ApiError } from "@/lib/api-client";

interface DscCert {
  serial: string;
  subject: string;
  issuer: string;
  algorithm: string;
  validFrom: string;
  validTo: string;
  active: boolean;
}

interface DscInventory {
  envManaged: boolean;
  activeSerial: string | null;
  count: number;
  certificates: DscCert[];
}

export default function SigningKeysPage() {
  const [inv, setInv] = useState<DscInventory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setInv(await apiGet<DscInventory>("/api/v1/admin/dsc"));
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) setForbidden(true);
      else setError(e instanceof ApiError ? e.message : "Failed to load signing keys");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function rotate() {
    setRotating(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiPost<{ previousSerial?: string; certificate?: DscCert }>("/api/v1/admin/dsc/rotate", {});
      setNotice(
        `Rotated. New active serial ${res.certificate?.serial ?? "—"} (was ${res.previousSerial ?? "—"}). ` +
          `Previously signed prescriptions still verify against the retired key.`,
      );
      setConfirming(false);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Rotation failed");
    } finally {
      setRotating(false);
    }
  }

  if (forbidden) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-2xl font-bold text-slate-900">Signing keys</h1>
        <p className="mt-4 text-sm text-red-600">This area is restricted to platform administrators.</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold text-slate-900">Signing keys (DSC)</h1>
      <p className="mt-1 text-sm text-slate-500">
        Platform Digital Signature Certificates used to sign prescriptions (IT Act 2000 §3). Rotating issues a new
        active key while retired keys are retained so older prescriptions keep verifying.
      </p>

      {loading ? (
        <p className="mt-6 text-slate-400">Loading…</p>
      ) : inv ? (
        <div className="mt-6 space-y-4">
          <div className="card flex items-center justify-between p-4">
            <div className="text-sm">
              <div className="font-medium text-slate-900">
                {inv.count} certificate{inv.count === 1 ? "" : "s"} in keyring
              </div>
              <div className="text-slate-500">
                {inv.envManaged
                  ? "Key is environment/HSM-managed — rotation is owned by the Certifying Authority."
                  : "Active key signs new prescriptions; retired keys verify older ones."}
              </div>
            </div>
            {confirming ? (
              <div className="flex gap-2">
                <button className="btn-primary text-sm" onClick={rotate} disabled={rotating || inv.envManaged}>
                  {rotating ? "Rotating…" : "Confirm rotate"}
                </button>
                <button className="btn-ghost text-sm" onClick={() => setConfirming(false)} disabled={rotating}>
                  Cancel
                </button>
              </div>
            ) : (
              <button
                className="btn-primary text-sm"
                onClick={() => setConfirming(true)}
                disabled={inv.envManaged}
                title={inv.envManaged ? "Disabled for env/HSM-managed keys" : undefined}
              >
                Rotate key
              </button>
            )}
          </div>

          {notice && <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</p>}

          <div className="space-y-3">
            {inv.certificates
              .slice()
              .sort((a, b) => (a.active === b.active ? 0 : a.active ? -1 : 1))
              .map((c) => (
                <div key={c.serial} className="card p-4">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm text-slate-900">{c.serial}</span>
                    {c.active ? (
                      <span className="inline-flex h-5 items-center rounded-full bg-emerald-100 px-2 text-xs font-semibold text-emerald-700">
                        Active
                      </span>
                    ) : (
                      <span className="inline-flex h-5 items-center rounded-full bg-slate-100 px-2 text-xs font-semibold text-slate-500">
                        Retired (verify-only)
                      </span>
                    )}
                  </div>
                  <dl className="mt-3 grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="text-slate-500">Subject</dt>
                      <dd className="text-slate-800">{c.subject}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Issuer</dt>
                      <dd className="text-slate-800">{c.issuer}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Algorithm</dt>
                      <dd className="text-slate-800">{c.algorithm}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Valid</dt>
                      <dd className="text-slate-800">
                        {new Date(c.validFrom).toLocaleDateString("en-IN")} – {new Date(c.validTo).toLocaleDateString("en-IN")}
                      </dd>
                    </div>
                  </dl>
                </div>
              ))}
          </div>
        </div>
      ) : null}

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
    </div>
  );
}
