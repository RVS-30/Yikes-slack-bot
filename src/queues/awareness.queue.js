import { Queue } from "bullmq";
import IORedis from "ioredis";
import { config } from "../config/environment.js";

const connection = new IORedis(config.redisUrl, {
  maxRetriesPerRequest: null, // required by BullMQ
});

connection.on("connect", () => {
  console.log("🔗 Redis connected for awareness queue");
});

connection.on("error", (err) => {
  console.error("❌ Redis connection error:", err);
});

export const awarenessQueue = new Queue("awareness", {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 2000,
    },
    removeOnComplete: 100,
    removeOnFail: 500,
  },
});

console.log("📬 Awareness queue initialized");