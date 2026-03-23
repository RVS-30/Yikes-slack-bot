import { Worker } from "bullmq";
import IORedis from "ioredis";
import { runAwarenessWorker } from "./awareness.worker.js";
import { config } from "../config/environment.js";

console.log("🚀 Starting Awareness Worker...");

const connection = new IORedis(config.redisUrl, {
  maxRetriesPerRequest: null, // required by BullMQ
});

const worker = new Worker(
  "awareness", // must match the queue name in awareness.queue.js
  async (job) => {
    console.log("📥 Job received:", job.id);
    console.log("📦 Job data:", job.data);

    await runAwarenessWorker(job.data); // throws naturally → BullMQ marks job as failed + retries

    console.log("✅ Job processed:", job.id);
  },
  { connection }
);

worker.on("ready", () => {
  console.log("🔗 Worker connected to Redis");
});

worker.on("completed", (job) => {
  console.log(`🎉 Job ${job.id} completed`);
});

worker.on("failed", (job, err) => {
  console.error(`💥 Job ${job?.id} failed:`, err.message);
});

worker.on("retrying", (job, err) => {
  console.log(`🔄 Job ${job.id} retrying (attempt ${job.attemptsMade} of ${job.opts.attempts}) — reason: ${err.message}`);
});