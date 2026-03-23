import "dotenv/config";
import pkg from "pg";
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false, // required for Supabase
  },
  connectionTimeoutMillis: 15000, // fail after 15s instead of hanging forever
  query_timeout: 15000,
});

// Optional but recommended: basic connection test
pool.on("connect", () => {
  console.log("✅ Connected to PostgreSQL");
});

pool.on("error", (err) => {
  console.error("❌ Unexpected DB error", err);
});

export default pool;