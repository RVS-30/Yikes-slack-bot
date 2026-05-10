import { config } from './src/config/environment.js';
import { upsertUser } from './src/repositories/message.repository.js';
import { WebClient } from '@slack/web-api';
import pkg from 'pg';

const { Pool } = pkg;
const pool = new Pool({ connectionString: config.databaseUrl });
const client = new WebClient(config.slackBotToken);

const { rows } = await pool.query(`
  SELECT DISTINCT m.user_id, m.workspace_id
  FROM messages m
  LEFT JOIN users u ON u.user_id = m.user_id AND u.workspace_id = m.workspace_id
  WHERE u.user_id IS NULL AND m.user_id IS NOT NULL
`);

console.log(`Found ${rows.length} unresolved users`);

for (const row of rows) {
  try {
    const res = await client.users.info({ user: row.user_id });
    const profile = res.user?.profile;
    const displayName = profile?.display_name || profile?.real_name || res.user?.name || row.user_id;
    const avatarUrl = profile?.image_48 || null;
    await upsertUser(row.workspace_id, row.user_id, displayName, avatarUrl);
    console.log(`✅ Resolved ${row.user_id} → ${displayName}`);
  } catch (err) {
    console.warn(`⚠️ Failed to resolve ${row.user_id}:`, err.message);
  }
}

await pool.end();