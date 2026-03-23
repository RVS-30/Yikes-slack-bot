import pool from "../config/database.js";

// Insert message into database
export async function insertMessage(message) {
  const query = `
    INSERT INTO messages (
      workspace_id,
      channel_id,
      user_id,
      thread_ts,
      text,
      slack_timestamp,
      channel_type,
      raw_payload,
      created_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    RETURNING id;
  `;

  const values = [
    message.workspace_id,
    message.channel_id,
    message.user_id,
    message.thread_ts,
    message.text,
    message.slack_timestamp,
    message.channel_type,
    message.raw_payload,
    message.created_at,
  ];

  const result = await pool.query(query, values);
  return result.rows[0];
}

// Update message text
export async function updateMessageText({
  workspace_id,
  channel_id,
  slack_timestamp,
  text,
  raw_payload
}) {
  const query = `
    UPDATE messages
    SET 
      text = $1,
      raw_payload = $2,
      edited_at = NOW()
    WHERE workspace_id = $3
      AND channel_id = $4
      AND slack_timestamp = $5
    RETURNING id, thread_ts, slack_timestamp;
  `;

  const values = [
    text,
    raw_payload,
    workspace_id,
    channel_id,
    slack_timestamp
  ];

  const result = await pool.query(query, values);
  return result.rows[0];
}

// Mark message as deleted
export async function markMessageDeleted({
  workspace_id,
  channel_id,
  slack_timestamp
}) {
  const query = `
    UPDATE messages
    SET 
      deleted = TRUE,
      deleted_at = NOW()
    WHERE workspace_id = $1
      AND channel_id = $2
      AND slack_timestamp = $3
    RETURNING id, thread_ts, slack_timestamp;
  `;

  const values = [
    workspace_id,
    channel_id,
    slack_timestamp
  ];

  const result = await pool.query(query, values);
  return result.rows[0];
}

// Get message by ID
export async function getMessageById(messageId) {
  const { rows } = await pool.query(
    `SELECT id, text, user_id, workspace_id, channel_id, thread_ts, slack_timestamp
     FROM messages
     WHERE id = $1 AND processed = false`,
    [messageId]
  );
  return rows[0] || null;
}

// Update message enrichment
export async function updateMessageEnrichment(messageId, awareness) {
  await pool.query(
    `UPDATE messages
     SET
       message_type     = $1,
       importance_score = $2,
       entities         = $3,
       topic_tags       = $4,
       processed        = true
     WHERE id = $5`,
    [
      awareness.message_type,
      awareness.importance_score,
      JSON.stringify(awareness.entities),
      JSON.stringify(awareness.topic_tags),
      messageId,
    ]
  );
}

// Get thread messages
export async function getThreadMessages(workspaceId, channelId, threadTs) {
  const { rows } = await pool.query(
    `SELECT id, text, user_id, slack_timestamp
     FROM messages
     WHERE workspace_id = $1
       AND channel_id = $2
       AND thread_ts = $3
       AND deleted = false
     ORDER BY slack_timestamp ASC`,
    [workspaceId, channelId, threadTs]
  );
  return rows;
}

// Upsert thread dirty
export async function upsertThreadDirty(workspaceId, channelId, threadTs) {
  await pool.query(
    `INSERT INTO thread_embeddings (workspace_id, channel_id, thread_ts, needs_embedding)
     VALUES ($1, $2, $3, true)
     ON CONFLICT (workspace_id, channel_id, thread_ts)
     DO UPDATE SET
       needs_embedding = true,
       updated_at = NOW()
     WHERE thread_embeddings.needs_embedding = false`,
    [workspaceId, channelId, threadTs]
  );
}

// Get dirty threads
export async function getDirtyThreads() {
  const { rows } = await pool.query(
    `SELECT workspace_id, channel_id, thread_ts
     FROM thread_embeddings
     WHERE needs_embedding = true`
  );
  return rows;
}

//Clear dirty threads -not used anywhere
// export async function clearThreadDirty(workspaceId, channelId, threadTs) {
//   await pool.query(
//     `UPDATE thread_embeddings
//      SET
//        needs_embedding = false,
//        embedded_at = NOW(),
//        updated_at = NOW()
//      WHERE workspace_id = $1
//        AND channel_id = $2
//        AND thread_ts = $3`,
//     [workspaceId, channelId, threadTs]
//   );
// }

//Upsert thread embedding
export async function upsertThreadEmbedding(workspaceId, channelId, threadTs, content, embedding, messageCount) {
  await pool.query(
    `INSERT INTO thread_embeddings
      (workspace_id, channel_id, thread_ts, content, embedding, message_count, last_message_at, needs_embedding, embedded_at, updated_at)
     VALUES ($1, $2, $3, $4, $5::vector, $6, NOW(), false, NOW(), NOW())
     ON CONFLICT (workspace_id, channel_id, thread_ts)
     DO UPDATE SET
       content = EXCLUDED.content,
       embedding = EXCLUDED.embedding,
       message_count = EXCLUDED.message_count,
       last_message_at = NOW(),
       needs_embedding = false,
       embedded_at = NOW(),
       updated_at = NOW()`,
    [workspaceId, channelId, threadTs, content, JSON.stringify(embedding), messageCount]
  );
}

//delete thread embedding
export async function deleteThreadEmbedding(workspaceId, channelId, threadTs) {
  await pool.query(
    `DELETE FROM thread_embeddings
     WHERE workspace_id = $1
       AND channel_id = $2
       AND thread_ts = $3`,
    [workspaceId, channelId, threadTs]
  );
}