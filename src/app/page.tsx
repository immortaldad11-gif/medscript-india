import Link from "next/link";

const features = [
  { title: "Digital Prescriptions", body: "Tablet-optimised Rx entry with CDSCO drug lookup, schedule validation, and digital signatures." },
  { title: "Drug Interaction Alerts", body: "Real-time contraindication checks with medico-legal override logging." },
  { title: "India-Compliant", body: "Built around ABDM/ABHA, DPDPA 2023, Telemedicine Guidelines 2020, and Schedule H/H1/X rules." },
  { title: "WhatsApp Delivery", body: "Signed prescriptions delivered to patients via WhatsApp with QR verification." },
];

export default function Home() {
  return (
    <main className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-brand-600" />
            <span className="text-lg font-bold text-brand-700">MedScript India</span>
          </div>
          <nav className="flex items-center gap-3">
            <Link href="/login" className="btn-ghost">Log in</Link>
            <Link href="/register" className="btn-primary">Get started</Link>
          </nav>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-6 py-20">
        <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-brand-600">India-Compliant Digital Health</p>
        <h1 className="max-w-3xl text-4xl font-bold leading-tight text-slate-900 sm:text-5xl">
          Digital prescriptions & medical reports, built for the Indian healthcare ecosystem.
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-slate-600">
          Create, sign, and share structured digital prescriptions in seconds — with drug-interaction safety,
          consent-driven data sharing, and full regulatory compliance.
        </p>
        <div className="mt-8 flex gap-4">
          <Link href="/register" className="btn-primary px-6 py-3 text-base">Create an account</Link>
          <Link href="/login" className="btn-ghost px-6 py-3 text-base">Log in</Link>
        </div>

        <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((f) => (
            <div key={f.title} className="card p-5">
              <h3 className="font-semibold text-slate-900">{f.title}</h3>
              <p className="mt-2 text-sm text-slate-600">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-slate-200 bg-white py-6 text-center text-sm text-slate-500">
        MedScript India · Phase 1 MVP · Confidential
      </footer>
    </main>
  );
}
