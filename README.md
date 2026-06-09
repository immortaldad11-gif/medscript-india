# MedScript India

A cloud-native, India-compliant platform for **digital prescriptions and medical-report automation** — built around the Indian healthcare regulatory stack (IT Act 2000, Telemedicine Practice Guidelines 2020, DPDPA 2023, the Drugs & Cosmetics Act schedules, and ABDM/ABHA).

A doctor composes a prescription (typed or voice-dictated), the platform runs drug-safety checks, **digitally signs it** (RSA-SHA256 over a SHA-256 content digest), renders a PDF, delivers it to the patient, and exposes a **public, tamper-evident QR verification** page.

> **Status: Phase 1 MVP.** The codebase is built in "production-shaped stub" style — realistic interfaces and deterministic local implementations, with the external integrations (CA/HSM signing, ABDM, S3, WhatsApp) clearly marked as stubs. See [Production readiness](#production-readiness) before deploying anywhere real.

---

## Architecture

| Layer | Choice |
|---|---|
| Web / API | Next.js 14 (App Router), TypeScript |
| Data | PostgreSQL 15 via Prisma 5 |
| Cache / queue backing | Redis 7 |
| Async jobs | BullMQ (OCR, delivery) — inline when `QUEUE_ENABLED=0` |
| Auth | JWT access/refresh, RBAC (5 roles), mandatory TOTP 2FA for doctors/admins |
| PHI at rest | AES-256-GCM field encryption; encrypted document blobs |
| Signing | RSA-2048 platform DSC keyring (rotatable); env/HSM key support |
| PDF | pdfkit |
| UI | Tailwind CSS |

**Core journey:** `create Rx → schedule check (Schedule X blocked, H1 flagged) → drug-interaction check (contraindications require typed justification) → DSC sign → PDF → delivery → patient view → public /verify (recompute digest + verify signature)`.

---

## Prerequisites

- **Node.js 20+**
- **Docker** (for Postgres + Redis via Docker Compose)

## Quick start

```bash
# 1. Configure environment
cp .env.example .env
#    Generate a real field-encryption key (32 bytes, base64):
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
#    → paste into FIELD_ENCRYPTION_KEY in .env

# 2. Start Postgres + Redis
npm run db:up

# 3. Install deps + set up the database
npm install
npm run prisma:push     # apply the schema
npm run prisma:seed     # reference formulary + demo accounts

# 4. Run
npm run dev             # http://localhost:3000
```

> Doctors and admins must enrol 2FA on first login (`/setup-2fa`). In sandboxed dev where the host clock is skewed, set `DEV_TOTP_BYPASS` in `.env` (ignored when `NODE_ENV=production`).

## Demo accounts

All seeded with password **`Password123!`**. The login field (`identifier`) accepts phone **or** email.

| Role | Phone | Email |
|---|---|---|
| Super Admin | `+919000000000` | `admin@medscript.in` |
| Doctor (Dr. Rajesh Kumar) | `+919000000001` | `doctor@medscript.in` |
| Patient (Asha Verma) | `+919000000002` | `patient@medscript.in` |
| Lab Technician | `+919000000003` | `lab@medscript.in` |
| Radiologist | `+919000000004` | `radiology@medscript.in` |

---

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Start the Next.js dev server |
| `npm run build` / `npm start` | Production build / serve |
| `npm test` | Run the test suite (`node:test` + `tsx`) |
| `npm run lint` | ESLint (`next/core-web-vitals`) |
| `npm run worker` | Standalone BullMQ worker (when `QUEUE_ENABLED=1`) |
| `npm run db:up` / `db:down` | Start / stop Postgres + Redis |
| `npm run prisma:push` | Apply the Prisma schema to the DB |
| `npm run prisma:seed` | Seed the formulary + demo accounts |
| `npm run prisma:studio` | Prisma Studio (DB browser) |
| `npm run storage:migrate` | Migrate document blobs from local disk to S3 |

## Testing

Zero-dependency harness: Node's built-in `node:test` run through `tsx`. Each test file runs in its own process for module-cache + env isolation.

```bash
npm test
```

**70 tests** across two tiers:

- **Security primitives** — field encryption (AES-256-GCM round-trip + tamper rejection), DSC sign/verify/rotate, RBAC matrix + server-side 2FA gating, auth-secret fail-fast + JWT algorithm pinning, local storage driver + migration invariant, **S3 backend (validated against MinIO)**, prescription integrity signatures, rate limiting.
- **Business logic** — voice-dictation NLP parser, drug-schedule rules + interaction detection, consent auto-expiry, prescription idempotency.

Tests that need Postgres / Redis / an S3 endpoint **skip gracefully** when those services are down, so the suite still runs without `docker compose up` (the CI workflow in `.github/workflows/ci.yml` provides all three — Postgres, Redis, and MinIO).

---

## Project structure

```
src/
  app/                 # App Router: pages (app)/ and API routes api/v1/
  lib/                 # Domain logic: auth, rbac, crypto, dsc, signature,
                       # drug-schedules, voice-rx, consent, storage, queue, ...
prisma/
  schema.prisma        # Data model
  seed.ts              # Demo accounts + reference data
  formulary.ts         # Curated CDSCO-style drug list + interaction pairs
tests/                 # node:test suites
.github/workflows/     # CI pipeline
```

## Deploying with Docker

The app ships as a multi-stage image (Next.js **standalone**, non-root, health-checked) plus a production Compose stack — web + Postgres + Redis + a one-shot migration step, with persistent volumes.

```bash
cp .env.example .env     # set REAL secrets: JWT_ACCESS_SECRET, JWT_REFRESH_SECRET,
                         # FIELD_ENCRYPTION_KEY (32-byte base64), POSTGRES_PASSWORD, ...
docker compose -f docker-compose.prod.yml up -d --build
#   → migrations run, then web comes up on http://localhost:3000 (set WEB_PORT to change)

docker compose -f docker-compose.prod.yml logs -f web            # tail logs
docker compose -f docker-compose.prod.yml run --rm migrate npx prisma db seed   # demo data (optional)
docker compose -f docker-compose.prod.yml --profile worker up -d # async worker (only if QUEUE_ENABLED=1)
```

- **Secrets are injected at runtime** (via `.env` / your orchestrator), never baked into the image. In production the app **fails fast** if the `JWT_*` secrets are unset or left at the dev default.
- **Migrations** use `prisma migrate deploy` (the `migrate` service); the initial migration ships in `prisma/migrations/`. If you previously created the DB with `prisma db push`, baseline it once: `prisma migrate resolve --applied 0_init`.
- **Persistence** — the `storage` volume holds the local document store **and the DSC signing keyring**; it must survive restarts or previously-signed prescriptions won't verify. For real PHI, prefer `STORAGE_DRIVER=s3` for documents and env-managed DSC keys (`DSC_*_PEM`) so nothing sensitive lives on local disk.
- The single image deploys to any container host (Railway / Render / Fly.io / ECS / a VPS) with managed Postgres + Redis.

## Security & compliance notes

- **PHI encryption** (ABHA ID, Aadhaar, 2FA secrets) — AES-256-GCM, `FIELD_ENCRYPTION_KEY` (§2.3.2).
- **Digital signatures** — RSA-SHA256 over a SHA-256 content digest; tamper-evident public verification (IT Act 2000 §3).
- **Schedule enforcement** — Schedule X blocked from telemedicine, H1 flagged (Drugs & Cosmetics Act; Telemedicine Guidelines 2020).
- **Consent & audit** — time-bounded, O(1)-revocable consent for data sharing; immutable audit trail (DPDPA 2023).
- **Rate limiting** — Redis-backed per-IP/-user throttling on auth and OTP endpoints.

## Production readiness

What's implemented is production-shaped, but these integrations are **deterministic local stubs** and must be replaced before handling real patient data:

| Area | Current (dev) | Production needs |
|---|---|---|
| DSC signing | self-generated RSA-2048 keyring under `storage/.dsc/` | licensed CA (e.g. eMudhra) key in an HSM, via `DSC_*_PEM` |
| ABDM / ABHA | simulated link + fixed dev OTP | real ABDM Gateway integration |
| Document storage | encrypted blobs on local disk | S3 (`STORAGE_DRIVER=s3`) — bytes are app-encrypted either way |
| Notifications | `NOTIFICATIONS_DRIVER=log` (console) | Gupshup WhatsApp Business API / DLT-registered SMS |
| MCI/NMC verification | stubbed registration check | real NMC registry lookup |

Deployment itself is now containerised (see [Deploying with Docker](#deploying-with-docker)). What still stands between this and a *live, billable* service is non-code: a hosting target with managed Postgres + Redis, a git remote so CI runs, the **licensed** integrations above (a CA-issued DSC, ABDM registration, a WhatsApp provider), and the regulatory/compliance footing to legally operate a telemedicine prescription service in India.
