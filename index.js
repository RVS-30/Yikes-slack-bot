import { app, config } from "./src/app.js";
import pool from "./src/config/database.js";
import { startEmbeddingScheduler } from "./src/schedulers/embedding.scheduler.js";

try {
  console.log("🔎 Testing database connection...");
  console.log("   (Supabase free-tier may take 15-30s to wake up)");

  await pool.query("SELECT 1");
  console.log("✅ Database connected successfully");

  console.log(`Starting Slack app on port ${config.port}...`);

  await app.start(config.port);
  console.log(`⚡️ Slack app is running on port ${config.port}!`);

  startEmbeddingScheduler();

} catch (error) {
  console.error("❌ Failed to start application:", error);
  process.exit(1);
}