import "dotenv/config";

const required = ["SLACK_BOT_TOKEN", "SLACK_SIGNING_SECRET", "GEMINI_API_KEY", "REDIS_URL", "DATABASE_URL"];

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

export const config = {
  slackBotToken: process.env.SLACK_BOT_TOKEN,
  slackSigningSecret: process.env.SLACK_SIGNING_SECRET,
  geminiApiKey: process.env.GEMINI_API_KEY,
  redisUrl: process.env.REDIS_URL,
  databaseUrl: process.env.DATABASE_URL,
  port: Number(process.env.PORT) || 4390,
};