"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPost, ApiError } from "@/lib/api-client";

interface Drug {
  id: string;
  name: string;
  schedule: "H" | "H1" | "X" | "OTC";
  strength: string | null;
  form: string | null;
}
interface MedRow {
  drugName: string;
  schedule?: string;
  dosage: string;
  unit: string;
  frequency: string;
  duration: string;
  instructions: string;
}
interface Interaction {
  drugA: string;
  drugB: string;
  severity: "CONTRAINDICATED" | "MAJOR" | "MODERATE" | "MINOR";
  description: string;
}
interface ScheduleInfo {
  drugName: string;
  schedule: string;
  allowed: boolean;
  reason?: string;
  known: boolean;
}
interface ParsedMed {
  drugName: string;
  dosage: string;
  unit: string;
  frequency: string;
  duration: string;
  instructions: string;
  matchedDrug: boolean;
}
interface ParsedRx {
  chiefComplaint?: string;
  diagnosisText?: string;
  medications: ParsedMed[];
  unmatchedSegments: string[];
}

// Minimal Web Speech API typings (not in the standard DOM lib).
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
}

const FREQUENCIES = ["OD", "BD", "TDS", "QID", "HS", "SOS", "STAT"];
const UNITS = ["mg", "ml", "tab", "cap", "drops", "puff"];
// Duration presets for the Rx form. Stored as free-text strings (e.g. "5 days") so
// they stay compatible with what the voice parser emits and what the API expects.
const DURATIONS = [
  "1 day",
  "2 days",
  "3 days",
  "5 days",
  "7 days",
  "10 days",
  "14 days",
  "15 days",
  "21 days",
  "30 days",
  "2 months",
  "3 months",
  "Continuous",
];

const SEVERITY_STYLES: Record<string, string> = {
  CONTRAINDICATED: "border-red-300 bg-red-50 text-red-800",
  MAJOR: "border-orange-300 bg-orange-50 text-orange-800",
  MODERATE: "border-amber-300 bg-amber-50 text-amber-800",
  MINOR: "border-emerald-300 bg-emerald-50 text-emerald-800",
};

function emptyRow(): MedRow {
  return { drugName: "", dosage: "", unit: "mg", frequency: "BD", duration: "5 days", instructions: "" };
}

export default function NewPrescriptionPage() {
  const router = useRouter();
  const [patientName, setPatientName] = useState("");
  const [patientPhone, setPatientPhone] = useState("");
  const [chiefComplaint, setChiefComplaint] = useState("");
  const [diagnosisText, setDiagnosisText] = useState("");
  const [notes, setNotes] = useState("");
  const [followUpDate, setFollowUpDate] = useState("");
  const [rows, setRows] = useState<MedRow[]>([emptyRow()]);

  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [schedules, setSchedules] = useState<ScheduleInfo[]>([]);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const idempotencyKey = useRef(crypto.randomUUID());

  // Voice dictation (Web Speech API → parse-voice endpoint).
  const [transcript, setTranscript] = useState("");
  const [listening, setListening] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);
  const [voiceSupported, setVoiceSupported] = useState(true);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) {
      setVoiceSupported(false);
      return;
    }
    const rec = new Ctor();
    rec.lang = "en-IN";
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (e) => {
      let chunk = "";
      for (let i = 0; i < e.results.length; i++) chunk += e.results[i][0].transcript + " ";
      setTranscript((prev) => (prev ? `${prev} ${chunk}`.replace(/\s+/g, " ").trim() : chunk.trim()));
    };
    rec.onend = () => setListening(false);
    rec.onerror = (e) => {
      setListening(false);
      setVoiceNotice(`Microphone error: ${e.error}`);
    };
    recognitionRef.current = rec;
    return () => rec.stop();
  }, []);

  function toggleDictation() {
    const rec = recognitionRef.current;
    if (!rec) return;
    if (listening) {
      rec.stop();
      setListening(false);
    } else {
      setVoiceNotice(null);
      try {
        rec.start();
        setListening(true);
      } catch {
        // start() throws if already started; ignore.
      }
    }
  }

  async function parseTranscript() {
    if (!transcript.trim()) return setVoiceNotice("Dictate or type something first.");
    setParsing(true);
    setVoiceNotice(null);
    try {
      const res = await apiPost<ParsedRx>("/api/v1/prescriptions/parse-voice", { transcript });
      if (res.chiefComplaint) setChiefComplaint(res.chiefComplaint);
      if (res.diagnosisText) setDiagnosisText(res.diagnosisText);
      if (res.medications.length > 0) {
        setRows(
          res.medications.map((m) => ({
            drugName: m.drugName,
            schedule: undefined,
            dosage: m.dosage,
            unit: m.unit,
            frequency: m.frequency,
            duration: m.duration,
            instructions: m.instructions,
          })),
        );
      }
      const bits = [`${res.medications.length} medication(s) extracted`];
      if (res.unmatchedSegments.length) bits.push(`${res.unmatchedSegments.length} unclear segment(s) — please review`);
      setVoiceNotice(`${bits.join(" · ")}. Review every field before signing.`);
    } catch (err) {
      setVoiceNotice(err instanceof ApiError ? err.message : "Failed to parse dictation");
    } finally {
      setParsing(false);
    }
  }

  // Real-time interaction + schedule check when drug names change (Section 4.1.2).
  useEffect(() => {
    const names = rows.map((r) => r.drugName.trim()).filter(Boolean);
    if (names.length === 0) {
      setInteractions([]);
      setSchedules([]);
      return;
    }
    const t = setTimeout(() => {
      apiPost<{ interactions: Interaction[]; schedules: ScheduleInfo[] }>("/api/v1/drugs/interactions", { drugNames: names })
        .then((res) => {
          setInteractions(res.interactions);
          setSchedules(res.schedules);
        })
        .catch(() => {});
    }, 350);
    return () => clearTimeout(t);
  }, [rows]);

  function updateRow(i: number, patch: Partial<MedRow>) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function addRow() {
    setRows((rs) => [...rs, emptyRow()]);
  }
  function removeRow(i: number) {
    setRows((rs) => (rs.length === 1 ? rs : rs.filter((_, idx) => idx !== i)));
  }

  const blockedSchedules = schedules.filter((s) => !s.allowed);
  const contraindicated = interactions.filter((i) => i.severity === "CONTRAINDICATED");
  const pairKey = (a: string, b: string) => [a.toLowerCase(), b.toLowerCase()].sort().join("|");
  const allContraJustified = contraindicated.every((c) => (overrides[pairKey(c.drugA, c.drugB)] ?? "").trim().length >= 10);

  async function submit() {
    setError(null);
    if (!patientName.trim()) return setError("Patient name is required");
    if (rows.every((r) => !r.drugName.trim())) return setError("Add at least one medication");
    if (blockedSchedules.length > 0) return setError("Remove Schedule X drugs — they cannot be prescribed via telemedicine");
    if (!allContraJustified) return setError("Provide a clinical justification for each contraindicated interaction");

    setSubmitting(true);
    try {
      const body = {
        patientName,
        patientPhone: patientPhone || undefined,
        chiefComplaint: chiefComplaint || undefined,
        diagnosisText: diagnosisText || undefined,
        notes: notes || undefined,
        followUpDate: followUpDate || undefined,
        idempotencyKey: idempotencyKey.current,
        medications: rows
          .filter((r) => r.drugName.trim())
          .map((r) => ({
            drugName: r.drugName.trim(),
            dosage: r.dosage || "1",
            unit: r.unit,
            frequency: r.frequency,
            duration: r.duration || "5 days",
            instructions: r.instructions || undefined,
          })),
        interactionOverrides: contraindicated.map((c) => ({
          drugA: c.drugA,
          drugB: c.drugB,
          justification: overrides[pairKey(c.drugA, c.drugB)],
        })),
      };
      const created = await apiPost<{ id: string }>("/api/v1/prescriptions", body);
      router.push(`/prescriptions?created=${created.id}`);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Failed to create prescription");
      }
      setSubmitting(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <h1 className="text-2xl font-bold text-slate-900">New Prescription</h1>

        {/* Voice dictation */}
        <div className="card p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-slate-800">Dictate prescription</h2>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={toggleDictation}
                disabled={!voiceSupported}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                  listening ? "bg-red-50 text-red-700" : "btn-ghost"
                } ${!voiceSupported ? "cursor-not-allowed opacity-50" : ""}`}
              >
                {listening ? "■ Stop" : "● Dictate"}
              </button>
              <button type="button" onClick={parseTranscript} disabled={parsing || !transcript.trim()} className="btn-primary py-1.5 text-sm">
                {parsing ? "Parsing…" : "Parse & fill"}
              </button>
            </div>
          </div>
          {!voiceSupported && (
            <p className="mt-2 text-xs text-amber-600">
              Speech recognition isn&apos;t available in this browser — you can still type the dictation below and parse it.
            </p>
          )}
          <textarea
            className="input mt-3"
            rows={3}
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            placeholder='e.g. "Patient complains of fever and sore throat. Diagnosis acute pharyngitis. Start Amoxicillin 500 mg twice daily for 7 days after food, and Paracetamol 650 mg thrice daily for 3 days."'
          />
          {listening && <p className="mt-2 text-xs text-red-600">● Listening… speak the medications, dose, frequency and duration.</p>}
          {voiceNotice && <p className="mt-2 text-xs text-slate-600">{voiceNotice}</p>}
          <p className="mt-2 text-xs text-slate-400">
            Parsing pre-fills the form. Safety checks still run and you must review &amp; sign — voice never auto-submits.
          </p>
        </div>

        {/* Patient + clinical context */}
        <div className="card p-5">
          <h2 className="mb-3 font-semibold text-slate-800">Patient</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Patient name</label>
              <input className="input" value={patientName} onChange={(e) => setPatientName(e.target.value)} />
            </div>
            <div>
              <label className="label">Phone (for WhatsApp delivery)</label>
              <input className="input" value={patientPhone} onChange={(e) => setPatientPhone(e.target.value)} placeholder="+919876543210" />
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <label className="label">Chief complaint</label>
              <input className="input" value={chiefComplaint} onChange={(e) => setChiefComplaint(e.target.value)} maxLength={500} />
            </div>
            <div>
              <label className="label">Diagnosis</label>
              <input className="input" value={diagnosisText} onChange={(e) => setDiagnosisText(e.target.value)} />
            </div>
          </div>
        </div>

        {/* Medications */}
        <div className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold text-slate-800">Medications</h2>
            <button onClick={addRow} className="btn-ghost py-1.5 text-sm">+ Add drug</button>
          </div>
          <div className="space-y-4">
            {rows.map((row, i) => (
              <MedicationRow
                key={i}
                row={row}
                schedule={schedules.find((s) => s.drugName.toLowerCase() === row.drugName.trim().toLowerCase())}
                onChange={(patch) => updateRow(i, patch)}
                onRemove={() => removeRow(i)}
                canRemove={rows.length > 1}
              />
            ))}
          </div>
        </div>

        <div className="card p-5">
          <h2 className="mb-3 font-semibold text-slate-800">Advice & follow-up</h2>
          <div>
            <label className="label">Advice / notes</label>
            <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div className="mt-3 w-48">
            <label className="label">Follow-up date</label>
            <input className="input" type="date" value={followUpDate} onChange={(e) => setFollowUpDate(e.target.value)} />
          </div>
        </div>
      </div>

      {/* Safety panel */}
      <div className="space-y-4">
        <div className="card sticky top-6 p-5">
          <h2 className="font-semibold text-slate-800">Safety checks</h2>

          {blockedSchedules.length > 0 && (
            <div className="mt-3 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
              <p className="font-semibold">Blocked (Schedule X)</p>
              {blockedSchedules.map((b) => (
                <p key={b.drugName} className="mt-1">{b.drugName}: {b.reason}</p>
              ))}
            </div>
          )}

          {schedules.some((s) => s.schedule === "H1" && s.allowed) && (
            <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
              <p className="font-semibold">Schedule H1 present</p>
              <p className="mt-1">Enhanced control — patient address & stricter records required.</p>
            </div>
          )}

          {interactions.length === 0 ? (
            <p className="mt-3 text-sm text-slate-400">No interactions detected.</p>
          ) : (
            <div className="mt-3 space-y-3">
              {interactions.map((it, idx) => (
                <div key={idx} className={`rounded-lg border p-3 text-sm ${SEVERITY_STYLES[it.severity]}`}>
                  <p className="font-semibold">{it.severity}: {it.drugA} + {it.drugB}</p>
                  <p className="mt-1 text-xs">{it.description}</p>
                  {it.severity === "CONTRAINDICATED" && (
                    <textarea
                      className="input mt-2 text-xs"
                      rows={2}
                      placeholder="Typed clinical justification required (min 10 chars)…"
                      value={overrides[pairKey(it.drugA, it.drugB)] ?? ""}
                      onChange={(e) => setOverrides((o) => ({ ...o, [pairKey(it.drugA, it.drugB)]: e.target.value }))}
                    />
                  )}
                </div>
              ))}
            </div>
          )}

          {error && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          <button
            onClick={submit}
            disabled={submitting || blockedSchedules.length > 0 || !allContraJustified}
            className="btn-primary mt-4 w-full py-2.5"
          >
            {submitting ? "Signing & sending…" : "Sign & send prescription"}
          </button>
          <p className="mt-2 text-center text-xs text-slate-400">
            Digitally signed · delivered via WhatsApp · QR-verifiable
          </p>
        </div>
      </div>
    </div>
  );
}

function MedicationRow({
  row,
  schedule,
  onChange,
  onRemove,
  canRemove,
}: {
  row: MedRow;
  schedule?: ScheduleInfo;
  onChange: (patch: Partial<MedRow>) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const [results, setResults] = useState<Drug[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const q = row.drugName.trim();
    if (q.length < 1 || schedule?.known) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      apiGet<Drug[]>(`/api/v1/drugs/search?q=${encodeURIComponent(q)}`).then(setResults).catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [row.drugName, schedule?.known]);

  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="flex items-start gap-3">
        <div className="relative flex-1">
          <label className="label">Drug</label>
          <input
            className="input"
            value={row.drugName}
            onChange={(e) => {
              onChange({ drugName: e.target.value });
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            placeholder="Start typing… e.g. Amoxicillin"
          />
          {open && results.length > 0 && (
            <ul className="absolute z-10 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg">
              {results.map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50"
                    onMouseDown={() => {
                      onChange({ drugName: d.name, schedule: d.schedule });
                      setOpen(false);
                    }}
                  >
                    <span>{d.name} {d.strength && <span className="text-slate-400">{d.strength}</span>}</span>
                    {d.schedule !== "OTC" && <span className="text-xs text-amber-600">[{d.schedule}]</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {schedule && (
            <p className={`mt-1 text-xs ${schedule.allowed ? "text-slate-400" : "text-red-600"}`}>
              {schedule.known ? "" : "Not in reference list · "}Schedule {schedule.schedule}
              {!schedule.allowed && " · BLOCKED"}
            </p>
          )}
        </div>
        <div className="w-20">
          <label className="label">Dose</label>
          <input className="input" value={row.dosage} onChange={(e) => onChange({ dosage: e.target.value })} placeholder="500" />
        </div>
        <div className="w-24">
          <label className="label">Unit</label>
          <select className="input" value={row.unit} onChange={(e) => onChange({ unit: e.target.value })}>
            {UNITS.map((u) => <option key={u}>{u}</option>)}
          </select>
        </div>
        <div className="w-24">
          <label className="label">Freq</label>
          <select className="input" value={row.frequency} onChange={(e) => onChange({ frequency: e.target.value })}>
            {FREQUENCIES.map((f) => <option key={f}>{f}</option>)}
          </select>
        </div>
        <div className="w-32">
          <label className="label">Duration</label>
          <select className="input" value={row.duration} onChange={(e) => onChange({ duration: e.target.value })}>
            {/* Keep any value the voice parser produced that isn't a preset (e.g. "1 weeks"). */}
            {row.duration && !DURATIONS.includes(row.duration) && <option value={row.duration}>{row.duration}</option>}
            {DURATIONS.map((dur) => (
              <option key={dur} value={dur}>
                {dur}
              </option>
            ))}
          </select>
        </div>
        {canRemove && (
          <button type="button" onClick={onRemove} className="mt-7 text-slate-400 hover:text-red-500" aria-label="Remove">✕</button>
        )}
      </div>
      <input
        className="input mt-2"
        value={row.instructions}
        onChange={(e) => onChange({ instructions: e.target.value })}
        placeholder="Instructions (e.g. after food)"
      />
    </div>
  );
}
