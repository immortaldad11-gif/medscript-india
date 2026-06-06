import { Queue, type ConnectionOptions } from "bullmq";
import { processOcrReport, processPrescriptionNotification } from "@/lib/jobs/processors";

// BullMQ async pipeline — Section 2.2. When QUEUE_ENABLED=1 (and Redis reachable),
// heavy/slow work (OCR, notification delivery) is offloaded to a separate worker
// process so API requests return immediately. Otherwise we run the same processor
// inline, preserving the single-process dev experience.

export const QUEUE_NAMES = {
  ocr: "ocr",
  notifications: "notifications",
  maintenance: "maintenance",
} as const;

export const QUEUE_ENABLED = process.env.QUEUE_ENABLED === "1" && !!process.env.REDIS_URL;

// BullMQ needs a dedicated connection with maxRetriesPerRequest disabled.
export function bullConnection(): ConnectionOptions {
  return { url: process.env.REDIS_URL, maxRetriesPerRequest: null } as ConnectionOptions;
}

const globalForQueue = globalThis as unknown as {
  ocrQueue?: Queue;
  notifyQueue?: Queue;
};

let ocrQueue: Queue | null = null;
let notifyQueue: Queue | null = null;

if (QUEUE_ENABLED) {
  // Pass connection *options* (not an ioredis instance): BullMQ creates and manages
  // its own client, which also sidesteps bullmq's bundled-ioredis type mismatch.
  const connection = bullConnection();
  const defaultJobOpts = {
    attempts: 3,
    backoff: { type: "exponential" as const, delay: 1000 },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  };
  ocrQueue = globalForQueue.ocrQueue ?? new Queue(QUEUE_NAMES.ocr, { connection, defaultJobOptions: defaultJobOpts });
  notifyQueue =
    globalForQueue.notifyQueue ?? new Queue(QUEUE_NAMES.notifications, { connection, defaultJobOptions: defaultJobOpts });
  if (process.env.NODE_ENV !== "production") {
    globalForQueue.ocrQueue = ocrQueue;
    globalForQueue.notifyQueue = notifyQueue;
  }
}

// Enqueue OCR structuring, or run it inline if the queue is off/unavailable.
export async function enqueueOcr(reportId: string): Promise<{ queued: boolean }> {
  if (ocrQueue) {
    // jobId dedups concurrent enqueues for the same report. BullMQ forbids ":" in
    // custom ids, so use "-" as the separator.
    await ocrQueue.add("structure", { reportId }, { jobId: `ocr-${reportId}` });
    return { queued: true };
  }
  await processOcrReport(reportId);
  return { queued: false };
}

// Enqueue prescription delivery, or run it inline if the queue is off/unavailable.
export async function enqueuePrescriptionNotification(prescriptionId: string): Promise<{ queued: boolean }> {
  if (notifyQueue) {
    await notifyQueue.add("deliver", { prescriptionId }, { jobId: `notify-${prescriptionId}` });
    return { queued: true };
  }
  await processPrescriptionNotification(prescriptionId);
  return { queued: false };
}
