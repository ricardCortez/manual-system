import { Queue, Worker } from "bullmq";
import { redis } from "../plugins/redis";
import { videoProcessor } from "./video.processor.job";
import { aiSummaryProcessor } from "./ai.summary.job";
import { notificationProcessor } from "./notifications.job";

// ──────────────────────────────────────────────────────
// Definición de colas BullMQ
// ──────────────────────────────────────────────────────

const defaultJobOptions = {
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 200 },
};

export const videoQueue = new Queue("video-processing", {
  connection: redis,
  defaultJobOptions: {
    ...defaultJobOptions,
    attempts: 3,
    backoff: { type: "exponential", delay: 10000 },
  },
});

export const aiQueue = new Queue("ai-processing", {
  connection: redis,
  defaultJobOptions: {
    ...defaultJobOptions,
    attempts: 2,
    backoff: { type: "fixed", delay: 5000 },
  },
});

export const notificationQueue = new Queue("notifications", {
  connection: redis,
  defaultJobOptions: {
    ...defaultJobOptions,
    attempts: 3,
  },
});

// ──────────────────────────────────────────────────────
// Workers
// ──────────────────────────────────────────────────────

export const videoWorker = new Worker(
  "video-processing",
  videoProcessor,
  {
    connection: redis,
    concurrency: 2, // Máximo 2 videos procesando a la vez
    lockDuration: 3600000, // 1 hora — ffmpeg puede tardar mucho en CPU
    stalledInterval: 60000, // Revisar stalled jobs cada 1 min (no 30s)
  }
);

export const aiWorker = new Worker(
  "ai-processing",
  aiSummaryProcessor,
  {
    connection: redis,
    concurrency: parseInt(process.env.AI_MAX_CONCURRENT_JOBS || "3"),
    lockDuration: 300000, // 5 minutes — LLM on CPU can be slow
  }
);

export const notificationWorker = new Worker(
  "notifications",
  notificationProcessor,
  {
    connection: redis,
    concurrency: 10,
  }
);

// Logging de errores de workers
[videoWorker, aiWorker, notificationWorker].forEach((worker) => {
  worker.on("failed", (job, err) => {
    console.error(`[Queue] Job ${job?.id} en cola "${worker.name}" falló:`, err.message);
  });

  worker.on("completed", (job) => {
    console.log(`[Queue] Job ${job.id} en cola "${worker.name}" completado`);
  });
});
