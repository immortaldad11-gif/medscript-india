import type { DrugSchedule, InteractionSeverity } from "@prisma/client";

// ---------------------------------------------------------------------------
// Reference formulary — Section 1.4 / 4.1.1.
//
// A broad, curated set of generic molecules spanning every major therapeutic
// class, with CDSCO-style schedule classification. A real deployment imports the
// full CDSCO approved list (and brand→generic mapping) + RxNorm/DrugBank for the
// interaction graph; this stand-in is large enough that the Rx picker and the
// voice-dictation matcher behave like the real thing.
//
// Schedule legend (drives the telemedicine safety rules in drug-schedules.ts):
//   OTC — unscheduled / pharmacy
//   H   — prescription-only
//   H1  — enhanced control (3rd-gen antibiotics, anti-TB, habit-forming sedatives/opioids)
//   X   — narcotic/psychotropic; BLOCKED via telemedicine
// ---------------------------------------------------------------------------

export interface SeedDrug {
  name: string;
  generic?: string;
  schedule: DrugSchedule;
  form?: string;
  strength?: string;
}

// `name` is the generic molecule (unique). `generic` is kept equal for searchability.
const d = (name: string, schedule: DrugSchedule, form: string, strength: string): SeedDrug => ({
  name,
  generic: name,
  schedule,
  form,
  strength,
});

export const DRUGS: SeedDrug[] = [
  // ── Antibiotics: penicillins ──────────────────────────────────────────────
  d("Amoxicillin", "H", "capsule", "500mg"),
  d("Amoxicillin + Clavulanic Acid", "H", "tablet", "625mg"),
  d("Ampicillin", "H", "capsule", "500mg"),
  d("Cloxacillin", "H", "capsule", "500mg"),
  d("Benzylpenicillin", "H", "injection", "1MU"),
  d("Piperacillin + Tazobactam", "H", "injection", "4.5g"),
  // ── Antibiotics: cephalosporins (3rd-gen → H1) ────────────────────────────
  d("Cephalexin", "H", "capsule", "500mg"),
  d("Cefuroxime", "H", "tablet", "500mg"),
  d("Cefixime", "H1", "tablet", "200mg"),
  d("Cefpodoxime", "H1", "tablet", "200mg"),
  d("Ceftriaxone", "H1", "injection", "1g"),
  d("Cefoperazone + Sulbactam", "H1", "injection", "1.5g"),
  d("Meropenem", "H1", "injection", "1g"),
  // ── Antibiotics: macrolides ───────────────────────────────────────────────
  d("Azithromycin", "H", "tablet", "500mg"),
  d("Clarithromycin", "H", "tablet", "500mg"),
  d("Erythromycin", "H", "tablet", "250mg"),
  d("Roxithromycin", "H", "tablet", "150mg"),
  // ── Antibiotics: fluoroquinolones ─────────────────────────────────────────
  d("Ciprofloxacin", "H", "tablet", "500mg"),
  d("Levofloxacin", "H", "tablet", "500mg"),
  d("Ofloxacin", "H", "tablet", "200mg"),
  d("Moxifloxacin", "H", "tablet", "400mg"),
  d("Norfloxacin", "H", "tablet", "400mg"),
  // ── Antibiotics: tetracyclines / others ───────────────────────────────────
  d("Doxycycline", "H", "capsule", "100mg"),
  d("Minocycline", "H", "capsule", "100mg"),
  d("Clindamycin", "H", "capsule", "300mg"),
  d("Linezolid", "H", "tablet", "600mg"),
  d("Vancomycin", "H", "injection", "500mg"),
  d("Gentamicin", "H", "injection", "80mg"),
  d("Amikacin", "H", "injection", "500mg"),
  d("Nitrofurantoin", "H", "tablet", "100mg"),
  d("Cotrimoxazole", "H", "tablet", "960mg"),
  d("Metronidazole", "H", "tablet", "400mg"),
  d("Tinidazole", "H", "tablet", "500mg"),
  d("Ornidazole", "H", "tablet", "500mg"),
  // ── Anti-tubercular (H1) ──────────────────────────────────────────────────
  d("Isoniazid", "H1", "tablet", "300mg"),
  d("Rifampicin", "H1", "capsule", "450mg"),
  d("Ethambutol", "H1", "tablet", "800mg"),
  d("Pyrazinamide", "H1", "tablet", "750mg"),
  // ── Antifungals ───────────────────────────────────────────────────────────
  d("Fluconazole", "H", "tablet", "150mg"),
  d("Itraconazole", "H", "capsule", "100mg"),
  d("Ketoconazole", "H", "tablet", "200mg"),
  d("Griseofulvin", "H", "tablet", "250mg"),
  d("Terbinafine", "H", "tablet", "250mg"),
  d("Clotrimazole", "OTC", "cream", "1%"),
  // ── Antivirals ────────────────────────────────────────────────────────────
  d("Acyclovir", "H", "tablet", "400mg"),
  d("Valacyclovir", "H", "tablet", "500mg"),
  d("Oseltamivir", "H", "capsule", "75mg"),
  // ── Antimalarials / antiparasitic ─────────────────────────────────────────
  d("Hydroxychloroquine", "H", "tablet", "200mg"),
  d("Chloroquine", "H", "tablet", "250mg"),
  d("Artemether + Lumefantrine", "H", "tablet", "80/480mg"),
  d("Albendazole", "OTC", "tablet", "400mg"),
  d("Ivermectin", "H", "tablet", "12mg"),
  // ── Analgesics / antipyretics / NSAIDs ────────────────────────────────────
  d("Paracetamol", "OTC", "tablet", "500mg"),
  d("Ibuprofen", "OTC", "tablet", "400mg"),
  d("Diclofenac", "H", "tablet", "50mg"),
  d("Aceclofenac", "H", "tablet", "100mg"),
  d("Naproxen", "H", "tablet", "250mg"),
  d("Etoricoxib", "H", "tablet", "90mg"),
  d("Ketorolac", "H", "injection", "30mg"),
  d("Mefenamic Acid", "H", "tablet", "500mg"),
  d("Nimesulide", "H", "tablet", "100mg"),
  d("Serratiopeptidase", "H", "tablet", "10mg"),
  // ── Opioids (H1 / X) ──────────────────────────────────────────────────────
  d("Tramadol", "H1", "tablet", "50mg"),
  d("Codeine", "H1", "syrup", "10mg/5ml"),
  d("Buprenorphine", "H1", "tablet", "0.2mg"),
  d("Morphine", "X", "injection", "10mg/ml"),
  d("Fentanyl", "X", "injection", "50mcg/ml"),
  d("Pethidine", "X", "injection", "50mg/ml"),
  d("Pentazocine", "X", "injection", "30mg/ml"),
  // ── Antidiabetics ─────────────────────────────────────────────────────────
  d("Metformin", "H", "tablet", "500mg"),
  d("Glimepiride", "H", "tablet", "2mg"),
  d("Gliclazide", "H", "tablet", "80mg"),
  d("Glibenclamide", "H", "tablet", "5mg"),
  d("Pioglitazone", "H", "tablet", "15mg"),
  d("Sitagliptin", "H", "tablet", "100mg"),
  d("Vildagliptin", "H", "tablet", "50mg"),
  d("Teneligliptin", "H", "tablet", "20mg"),
  d("Dapagliflozin", "H", "tablet", "10mg"),
  d("Empagliflozin", "H", "tablet", "10mg"),
  d("Voglibose", "H", "tablet", "0.2mg"),
  d("Insulin Glargine", "H", "injection", "100IU/ml"),
  d("Insulin Human (Regular)", "H", "injection", "40IU/ml"),
  // ── Antihypertensives: ACE inhibitors / ARBs ──────────────────────────────
  d("Enalapril", "H", "tablet", "5mg"),
  d("Ramipril", "H", "tablet", "5mg"),
  d("Lisinopril", "H", "tablet", "10mg"),
  d("Telmisartan", "H", "tablet", "40mg"),
  d("Losartan", "H", "tablet", "50mg"),
  d("Olmesartan", "H", "tablet", "20mg"),
  d("Valsartan", "H", "tablet", "80mg"),
  // ── Antihypertensives: CCBs / beta-blockers / others ──────────────────────
  d("Amlodipine", "H", "tablet", "5mg"),
  d("Nifedipine", "H", "tablet", "10mg"),
  d("Cilnidipine", "H", "tablet", "10mg"),
  d("Atenolol", "H", "tablet", "50mg"),
  d("Metoprolol", "H", "tablet", "50mg"),
  d("Bisoprolol", "H", "tablet", "5mg"),
  d("Carvedilol", "H", "tablet", "6.25mg"),
  d("Nebivolol", "H", "tablet", "5mg"),
  d("Prazosin", "H", "tablet", "2.5mg"),
  d("Clonidine", "H", "tablet", "100mcg"),
  // ── Diuretics ─────────────────────────────────────────────────────────────
  d("Furosemide", "H", "tablet", "40mg"),
  d("Torsemide", "H", "tablet", "10mg"),
  d("Hydrochlorothiazide", "H", "tablet", "25mg"),
  d("Spironolactone", "H", "tablet", "25mg"),
  // ── Lipid-lowering ────────────────────────────────────────────────────────
  d("Atorvastatin", "H", "tablet", "10mg"),
  d("Rosuvastatin", "H", "tablet", "10mg"),
  d("Simvastatin", "H", "tablet", "20mg"),
  d("Fenofibrate", "H", "tablet", "160mg"),
  d("Ezetimibe", "H", "tablet", "10mg"),
  // ── Anticoagulant / antiplatelet ──────────────────────────────────────────
  d("Aspirin", "OTC", "tablet", "75mg"),
  d("Clopidogrel", "H", "tablet", "75mg"),
  d("Ticagrelor", "H", "tablet", "90mg"),
  d("Warfarin", "H", "tablet", "5mg"),
  d("Acenocoumarol", "H", "tablet", "2mg"),
  d("Rivaroxaban", "H", "tablet", "10mg"),
  d("Apixaban", "H", "tablet", "5mg"),
  d("Dabigatran", "H", "capsule", "110mg"),
  d("Enoxaparin", "H", "injection", "40mg"),
  // ── Cardiac: nitrates / antiarrhythmics ───────────────────────────────────
  d("Isosorbide Mononitrate", "H", "tablet", "20mg"),
  d("Nitroglycerin", "H", "tablet", "0.5mg"),
  d("Digoxin", "H", "tablet", "0.25mg"),
  d("Amiodarone", "H", "tablet", "200mg"),
  d("Ivabradine", "H", "tablet", "5mg"),
  // ── Respiratory: bronchodilators / inhaled steroids ───────────────────────
  d("Salbutamol", "H", "inhaler", "100mcg"),
  d("Levosalbutamol", "H", "syrup", "1mg/5ml"),
  d("Formoterol", "H", "inhaler", "6mcg"),
  d("Tiotropium", "H", "inhaler", "18mcg"),
  d("Budesonide", "H", "inhaler", "200mcg"),
  d("Fluticasone", "H", "inhaler", "125mcg"),
  d("Montelukast", "H", "tablet", "10mg"),
  d("Theophylline", "H", "tablet", "400mg"),
  d("Acebrophylline", "H", "capsule", "100mg"),
  d("Ambroxol", "OTC", "syrup", "30mg/5ml"),
  d("Bromhexine", "OTC", "syrup", "8mg/5ml"),
  d("Acetylcysteine", "H", "sachet", "600mg"),
  d("Guaifenesin", "OTC", "syrup", "100mg/5ml"),
  // ── Antihistamines ────────────────────────────────────────────────────────
  d("Cetirizine", "OTC", "tablet", "10mg"),
  d("Levocetirizine", "OTC", "tablet", "5mg"),
  d("Loratadine", "OTC", "tablet", "10mg"),
  d("Fexofenadine", "OTC", "tablet", "120mg"),
  d("Desloratadine", "OTC", "tablet", "5mg"),
  d("Chlorpheniramine", "OTC", "tablet", "4mg"),
  d("Hydroxyzine", "H", "tablet", "25mg"),
  d("Pheniramine", "H", "injection", "22.75mg/ml"),
  // ── Gastro: acid suppression ──────────────────────────────────────────────
  d("Omeprazole", "OTC", "capsule", "20mg"),
  d("Pantoprazole", "H", "tablet", "40mg"),
  d("Esomeprazole", "H", "tablet", "40mg"),
  d("Rabeprazole", "H", "tablet", "20mg"),
  d("Lansoprazole", "H", "capsule", "30mg"),
  d("Ranitidine", "OTC", "tablet", "150mg"),
  d("Famotidine", "OTC", "tablet", "20mg"),
  d("Antacid Gel (Magaldrate + Simethicone)", "OTC", "syrup", "400mg/5ml"),
  d("Sucralfate", "H", "syrup", "1g/10ml"),
  // ── Gastro: antiemetic / prokinetic / antispasmodic ───────────────────────
  d("Ondansetron", "H", "tablet", "4mg"),
  d("Domperidone", "H", "tablet", "10mg"),
  d("Metoclopramide", "H", "tablet", "10mg"),
  d("Dicyclomine", "H", "tablet", "10mg"),
  d("Drotaverine", "H", "tablet", "40mg"),
  d("Hyoscine Butylbromide", "H", "tablet", "10mg"),
  // ── Gastro: laxative / antidiarrhoeal / IBD ───────────────────────────────
  d("Lactulose", "OTC", "syrup", "10g/15ml"),
  d("Bisacodyl", "OTC", "tablet", "5mg"),
  d("Loperamide", "OTC", "tablet", "2mg"),
  d("Oral Rehydration Salts", "OTC", "sachet", "21.8g"),
  d("Racecadotril", "H", "capsule", "100mg"),
  d("Mesalazine", "H", "tablet", "400mg"),
  // ── CNS: antiepileptics ───────────────────────────────────────────────────
  d("Phenytoin", "H", "tablet", "100mg"),
  d("Sodium Valproate", "H", "tablet", "200mg"),
  d("Carbamazepine", "H", "tablet", "200mg"),
  d("Levetiracetam", "H", "tablet", "500mg"),
  d("Lamotrigine", "H", "tablet", "25mg"),
  d("Gabapentin", "H", "capsule", "300mg"),
  d("Pregabalin", "H", "capsule", "75mg"),
  // ── CNS: antidepressants ──────────────────────────────────────────────────
  d("Sertraline", "H", "tablet", "50mg"),
  d("Escitalopram", "H", "tablet", "10mg"),
  d("Fluoxetine", "H", "capsule", "20mg"),
  d("Paroxetine", "H", "tablet", "20mg"),
  d("Duloxetine", "H", "capsule", "30mg"),
  d("Venlafaxine", "H", "capsule", "37.5mg"),
  d("Amitriptyline", "H", "tablet", "25mg"),
  d("Mirtazapine", "H", "tablet", "15mg"),
  // ── CNS: antipsychotics / mood ────────────────────────────────────────────
  d("Olanzapine", "H", "tablet", "10mg"),
  d("Risperidone", "H", "tablet", "2mg"),
  d("Quetiapine", "H", "tablet", "100mg"),
  d("Aripiprazole", "H", "tablet", "10mg"),
  d("Haloperidol", "H", "tablet", "5mg"),
  d("Lithium Carbonate", "H", "tablet", "300mg"),
  // ── CNS: anxiolytics / hypnotics (H1) ─────────────────────────────────────
  d("Alprazolam", "H1", "tablet", "0.5mg"),
  d("Clonazepam", "H1", "tablet", "0.5mg"),
  d("Lorazepam", "H1", "tablet", "2mg"),
  d("Diazepam", "H1", "tablet", "5mg"),
  d("Zolpidem", "H1", "tablet", "10mg"),
  d("Etizolam", "H1", "tablet", "0.5mg"),
  // ── CNS stimulant (X) ─────────────────────────────────────────────────────
  d("Methylphenidate", "X", "tablet", "10mg"),
  // ── Neuro / migraine / vertigo ────────────────────────────────────────────
  d("Sumatriptan", "H", "tablet", "50mg"),
  d("Flunarizine", "H", "tablet", "10mg"),
  d("Betahistine", "H", "tablet", "16mg"),
  d("Baclofen", "H", "tablet", "10mg"),
  d("Tizanidine", "H", "tablet", "2mg"),
  // ── Corticosteroids ───────────────────────────────────────────────────────
  d("Prednisolone", "H", "tablet", "10mg"),
  d("Methylprednisolone", "H", "tablet", "16mg"),
  d("Dexamethasone", "H", "tablet", "0.5mg"),
  d("Hydrocortisone", "H", "injection", "100mg"),
  d("Deflazacort", "H", "tablet", "6mg"),
  // ── Thyroid / endocrine ───────────────────────────────────────────────────
  d("Levothyroxine", "H", "tablet", "50mcg"),
  d("Carbimazole", "H", "tablet", "5mg"),
  d("Cabergoline", "H", "tablet", "0.5mg"),
  // ── Urology / BPH ─────────────────────────────────────────────────────────
  d("Tamsulosin", "H", "capsule", "0.4mg"),
  d("Finasteride", "H", "tablet", "5mg"),
  d("Sildenafil", "H", "tablet", "50mg"),
  d("Tadalafil", "H", "tablet", "10mg"),
  d("Solifenacin", "H", "tablet", "5mg"),
  // ── DMARDs / immunosuppressants ───────────────────────────────────────────
  d("Methotrexate", "H", "tablet", "2.5mg"),
  d("Hydroxychloroquine Sulphate", "H", "tablet", "300mg"),
  d("Azathioprine", "H", "tablet", "50mg"),
  d("Sulfasalazine", "H", "tablet", "500mg"),
  // ── Gynaecology / hormones ────────────────────────────────────────────────
  d("Tranexamic Acid", "H", "tablet", "500mg"),
  d("Norethisterone", "H", "tablet", "5mg"),
  d("Medroxyprogesterone", "H", "tablet", "10mg"),
  d("Clomiphene", "H", "tablet", "50mg"),
  // ── Vitamins / minerals / supplements (OTC) ───────────────────────────────
  d("Vitamin D3 (Cholecalciferol)", "OTC", "sachet", "60000IU"),
  d("Vitamin B Complex", "OTC", "tablet", "—"),
  d("Methylcobalamin", "OTC", "tablet", "1500mcg"),
  d("Folic Acid", "OTC", "tablet", "5mg"),
  d("Ferrous Ascorbate", "OTC", "tablet", "100mg"),
  d("Calcium Carbonate + Vitamin D3", "OTC", "tablet", "500mg"),
  d("Multivitamin", "OTC", "capsule", "—"),
  d("Zinc Sulphate", "OTC", "tablet", "20mg"),
  d("Potassium Chloride", "H", "tablet", "600mg"),
  // ── Dermatology (topical) ─────────────────────────────────────────────────
  d("Mupirocin", "H", "ointment", "2%"),
  d("Betamethasone (topical)", "H", "cream", "0.05%"),
  d("Adapalene", "H", "gel", "0.1%"),
  d("Benzoyl Peroxide", "OTC", "gel", "2.5%"),
  d("Permethrin", "H", "lotion", "5%"),
  // ── Ophthalmic / ENT ──────────────────────────────────────────────────────
  d("Moxifloxacin (eye drops)", "H", "drops", "0.5%"),
  d("Carboxymethylcellulose (eye drops)", "OTC", "drops", "0.5%"),
  d("Olopatadine (eye drops)", "H", "drops", "0.1%"),
  d("Xylometazoline (nasal)", "OTC", "drops", "0.1%"),
];

// ---------------------------------------------------------------------------
// Curated drug–drug interaction pairs (RxNorm/DrugBank stand-in).
// Stored alphabetically by the seed (drugA < drugB) for deterministic lookup.
// ---------------------------------------------------------------------------
export interface SeedInteraction {
  a: string;
  b: string;
  severity: InteractionSeverity;
  description: string;
}

export const INTERACTIONS: SeedInteraction[] = [
  // Bleeding-risk cluster (anticoagulant / antiplatelet)
  { a: "Clopidogrel", b: "Warfarin", severity: "CONTRAINDICATED", description: "Combined use markedly increases bleeding risk; concurrent use is generally contraindicated without specialist oversight." },
  { a: "Aspirin", b: "Warfarin", severity: "MAJOR", description: "Additive anticoagulant/antiplatelet effect raises risk of serious GI and intracranial bleeding." },
  { a: "Ciprofloxacin", b: "Warfarin", severity: "MAJOR", description: "Ciprofloxacin potentiates warfarin, raising INR and bleeding risk; monitor INR closely." },
  { a: "Diclofenac", b: "Warfarin", severity: "MAJOR", description: "NSAID added to warfarin increases GI bleeding risk and may raise INR." },
  { a: "Aspirin", b: "Clopidogrel", severity: "MODERATE", description: "Dual antiplatelet therapy is sometimes intended, but increases bleeding risk — confirm it is deliberate." },
  { a: "Aspirin", b: "Ibuprofen", severity: "MODERATE", description: "Ibuprofen can blunt the cardioprotective antiplatelet effect of low-dose aspirin." },
  { a: "Rivaroxaban", b: "Aspirin", severity: "MAJOR", description: "Combining a direct oral anticoagulant with aspirin substantially increases bleeding risk." },
  // Opioid + sedative respiratory depression
  { a: "Alprazolam", b: "Tramadol", severity: "MAJOR", description: "CNS and respiratory depression risk when combining benzodiazepines with opioids." },
  { a: "Codeine", b: "Tramadol", severity: "MAJOR", description: "Additive opioid effect increases sedation and respiratory depression risk; also lowers seizure threshold." },
  { a: "Diazepam", b: "Morphine", severity: "MAJOR", description: "Benzodiazepine plus opioid markedly increases the risk of fatal respiratory depression." },
  { a: "Tramadol", b: "Sertraline", severity: "MAJOR", description: "Serotonergic combination raises the risk of serotonin syndrome; watch for agitation, clonus, hyperthermia." },
  // Statin myopathy
  { a: "Atorvastatin", b: "Clarithromycin", severity: "MAJOR", description: "CYP3A4 inhibition raises statin levels and the risk of myopathy/rhabdomyolysis." },
  { a: "Atorvastatin", b: "Azithromycin", severity: "MODERATE", description: "Possible increased statin exposure; monitor for myopathy symptoms." },
  { a: "Amlodipine", b: "Atorvastatin", severity: "MINOR", description: "Amlodipine can modestly raise atorvastatin levels; clinically minor at standard doses." },
  // QT prolongation
  { a: "Azithromycin", b: "Ondansetron", severity: "MODERATE", description: "Both prolong the QT interval; combined use raises arrhythmia risk in susceptible patients." },
  { a: "Amiodarone", b: "Levofloxacin", severity: "MAJOR", description: "Additive QT prolongation; avoid or monitor ECG closely." },
  // Renal / electrolyte
  { a: "Enalapril", b: "Spironolactone", severity: "MAJOR", description: "ACE inhibitor plus potassium-sparing diuretic can cause dangerous hyperkalaemia; monitor potassium." },
  { a: "Ramipril", b: "Potassium Chloride", severity: "MODERATE", description: "ACE inhibitor reduces potassium excretion; added potassium can cause hyperkalaemia." },
  { a: "Diclofenac", b: "Ramipril", severity: "MODERATE", description: "NSAIDs blunt ACE-inhibitor antihypertensive effect and can impair renal function (triple-whammy with diuretics)." },
  { a: "Digoxin", b: "Furosemide", severity: "MODERATE", description: "Diuretic-induced hypokalaemia increases the risk of digoxin toxicity; monitor electrolytes." },
  { a: "Lithium Carbonate", b: "Hydrochlorothiazide", severity: "MAJOR", description: "Thiazides reduce lithium clearance, raising lithium levels toward toxicity." },
  // Other
  { a: "Metformin", b: "Prednisolone", severity: "MODERATE", description: "Corticosteroids raise blood glucose and can offset metformin's effect; monitor glycaemia." },
  { a: "Sildenafil", b: "Isosorbide Mononitrate", severity: "CONTRAINDICATED", description: "PDE5 inhibitor with any nitrate causes profound, potentially fatal hypotension — contraindicated." },
  { a: "Methotrexate", b: "Diclofenac", severity: "MAJOR", description: "NSAIDs reduce methotrexate clearance, increasing toxicity risk." },
  { a: "Fluconazole", b: "Warfarin", severity: "MAJOR", description: "Fluconazole inhibits warfarin metabolism, raising INR and bleeding risk." },
];
