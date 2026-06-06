import { Worker, Queue, type Job } from "bullmq";
import { QUEUE_NAMES, bullConnection } from "@/lib/queue";
import {
  processOcrReport,
  processPrescriptionNotification,
  processConsentSweep,
} from "@/lib/jobs/processors";

// Standalone BullMQ worker process — run with `npm run worker` (Section 2.2).
// Processes OCR + notification jobs and runs the consent auto-revoke sweep on a
// schedule. Requires Redis; the Next.js server enqueues when QUEUE_ENABLED=1.

const connection = bullConnection();

const ocrWorker = new Worker(
  QUEUE_NAMES.ocr,
  async (job: Job) => {
    await processOcrReport(job.data.reportId);
  },
  { connection, concurrency: 4 },
);

const notifyWorker = new Worker(
  QUEUE_NAMES.notifications,
  async (job: Job) => {
    await processPrescriptionNotification(job.data.prescriptionId);
  },
  { connection, concurrency: 8 },
);

const maintenanceWorker = new Worker(
  QUEUE_NAMES.maintenance,
  async () => {
    const n = await processConsentSweep();
    if (n > 0) console.log(`[worker:maintenance] auto-expired ${n} consent(s)`);
  },
  { connection },
);

for (const [name, w] of [
  ["ocr", ocrWorker],
  ["notifications", notifyWorker],
  ["maintenance", maintenanceWorker],
] as const) {
  w.on("completed", (job) => console.log(`[worker:${name}] ✓ job ${job.id}`));
  w.on("failed", (job, err) => console.error(`[worker:${name}] ✗ job ${job?.id}:`, err.message));
}

// Schedule the consent sweep every 60s (idempotent: BullMQ dedups the repeat key).
async function scheduleMaintenance() {
  const q = new Queue(QUEUE_NAMES.maintenance, { connection });
  await q.add("consent-sweep", {}, { repeat: { every: 60_000 }, jobId: "consent-sweep" });
  // Run once immediately on boot too.
  await q.add("consent-sweep-boot", {});
}

scheduleMaintenance()
  .then(() => console.log("[worker] ready — ocr, notifications, maintenance (consent sweep every 60s)"))
  .catch((err) => {
    console.error("[worker] failed to schedule maintenance:", err);
    process.exit(1);
  });

async function shutdown() {
  console.log("[worker] shutting down…");
  await Promise.all([ocrWorker.close(), notifyWorker.close(), maintenanceWorker.close()]);
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
