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
  raw_payload,
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

  const values = [text, raw_payload, workspace_id, channel_id, slack_timestamp];

  const result = await pool.query(query, values);
  return result.rows[0];
}

// Mark message as deleted
export async function markMessageDeleted({
  workspace_id,
  channel_id,
  slack_timestamp,
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

  const values = [workspace_id, channel_id, slack_timestamp];

  const result = await pool.query(query, values);
  return result.rows[0];
}

// Get message by ID
export async function getMessageById(messageId) {
  const { rows } = await pool.query(
    `SELECT id, text, user_id, workspace_id, channel_id, thread_ts, slack_timestamp
     FROM messages
     WHERE id = $1 AND processed = false`,
    [messageId],
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
    ],
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
    [workspaceId, channelId, threadTs],
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
    [workspaceId, channelId, threadTs],
  );
}

// Get dirty threads
export async function getDirtyThreads() {
  const { rows } = await pool.query(
    `SELECT workspace_id, channel_id, thread_ts
     FROM thread_embeddings
     WHERE needs_embedding = true`,
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
export async function upsertThreadEmbedding(
  workspaceId,
  channelId,
  threadTs,
  content,
  embedding,
  messageCount,
) {
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
    [
      workspaceId,
      channelId,
      threadTs,
      content,
      JSON.stringify(embedding),
      messageCount,
    ],
  );
}

//delete thread embedding
export async function deleteThreadEmbedding(workspaceId, channelId, threadTs) {
  await pool.query(
    `DELETE FROM thread_embeddings
     WHERE workspace_id = $1
       AND channel_id = $2
       AND thread_ts = $3`,
    [workspaceId, channelId, threadTs],
  );
}

//search threads - for RAG
export async function searchThreads(
  workspaceId,
  embedding,
  allowedChannels,
  limit = 5,
) {
  const { rows } = await pool.query(
    `SELECT thread_ts, channel_id, content, message_count, last_message_at,
            1 - (embedding <=> $2::vector) AS similarity
     FROM thread_embeddings
     WHERE workspace_id = $1
       AND embedding IS NOT NULL
       AND channel_id = ANY($3::text[])
     ORDER BY embedding <=> $2::vector
     LIMIT $4`,
    [workspaceId, JSON.stringify(embedding), allowedChannels, limit],
  );
  return rows;
}

export async function upsertUser(workspaceId, userId, displayName, avatarUrl) {
  await pool.query(
    `INSERT INTO users (workspace_id, user_id, display_name, avatar_url, fetched_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (workspace_id, user_id)
     DO UPDATE SET
       display_name = EXCLUDED.display_name,
       avatar_url = EXCLUDED.avatar_url,
       fetched_at = NOW()`,
    [workspaceId, userId, displayName, avatarUrl],
  );
}

// Fetch cached users by IDs — returns a map of { user_id: display_name }
export async function getUsersByIds(workspaceId, userIds) {
  const { rows } = await pool.query(
    `SELECT user_id, display_name
     FROM users
     WHERE workspace_id = $1
       AND user_id = ANY($2::text[])`,
    [workspaceId, userIds],
  );
  return Object.fromEntries(rows.map((r) => [r.user_id, r.display_name]));
}

// Insert memory query
export async function insertMemoryQuery(
  workspaceId,
  userId,
  channelId,
  question,
  answer,
  threadsUsed,
) {
  await pool.query(
    `INSERT INTO memory_queries
      (workspace_id, user_id, channel_id, question, answer, threads_used, responded_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [workspaceId, userId, channelId, question, answer, threadsUsed],
  );
}

// Fetch recent decisions for a workspace
export async function getDecisions(workspaceId, channelId, limit = 10) {
  const { rows } = await pool.query(
    `SELECT m.user_id, m.text, m.importance_score, m.entities, m.topic_tags, m.slack_timestamp,
            u.display_name
     FROM messages m
     LEFT JOIN users u ON u.user_id = m.user_id AND u.workspace_id = m.workspace_id
     WHERE m.workspace_id = $1
       AND m.channel_id = $2
       AND m.message_type = 'decision'
       AND m.deleted = false
     ORDER BY m.slack_timestamp DESC
     LIMIT $3`,
    [workspaceId, channelId, limit],
  );
  return rows;
}

// Upsert user's accessible channels — called on every command
export async function upsertUserChannels(workspaceId, userId, channels) {
  if (!channels.length) return;

  const values = channels
    .map((_, i) => `($1, $2, $${i * 2 + 3}, $${i * 2 + 4}::boolean, NOW())`)
    .join(", ");

  const params = [workspaceId, userId];
  channels.forEach((c) => {
    params.push(c.channel_id);
    params.push(c.is_private);
  });

  await pool.query(
    `INSERT INTO user_channel_memberships
      (workspace_id, user_id, channel_id, is_private, synced_at)
     VALUES ${values}
     ON CONFLICT (workspace_id, user_id, channel_id)
     DO UPDATE SET
       is_private = EXCLUDED.is_private,
       synced_at = NOW()`,
    params,
  );
}

// Get accessible channel IDs for a user — used to filter all search queries
export async function getAccessibleChannels(workspaceId, userId) {
  const { rows } = await pool.query(
    `SELECT channel_id
     FROM user_channel_memberships
     WHERE workspace_id = $1
       AND user_id = $2`,
    [workspaceId, userId],
  );
  return rows.map((r) => r.channel_id);
}

// Check if membership needs re-sync — stale after 10 minutes
export async function isMembershipStale(workspaceId, userId) {
  const { rows } = await pool.query(
    `SELECT synced_at
     FROM user_channel_memberships
     WHERE workspace_id = $1
       AND user_id = $2
     ORDER BY synced_at DESC
     LIMIT 1`,
    [workspaceId, userId],
  );

  if (rows.length === 0) return true;

  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
  return new Date(rows[0].synced_at) < tenMinutesAgo;
}

// Fetch messages for summarization — current channel, last 7 days
export async function getSummaryMessages(workspaceId, channelId, from, to) {
  const { rows } = await pool.query(
    `SELECT m.user_id, m.text, m.message_type, m.importance_score, m.topic_tags, m.slack_timestamp,
            u.display_name
     FROM messages m
     LEFT JOIN users u ON u.user_id = m.user_id AND u.workspace_id = m.workspace_id
     WHERE m.workspace_id = $1
       AND m.channel_id = $2
       AND m.deleted = false
       AND m.slack_timestamp::numeric >= $3
       AND m.slack_timestamp::numeric <= $4
     ORDER BY m.slack_timestamp ASC`,
    [workspaceId, channelId, from, to],
  );
  return rows;
}

// Hybrid search — vector similarity + keyword fallback
export async function searchHybrid(
  workspaceId,
  embedding,
  keyword,
  allowedChannels,
  limit = 5,
) {
  const { rows } = await pool.query(
    `SELECT thread_ts, channel_id, content, message_count, last_message_at,
            1 - (embedding <=> $2::vector) AS similarity
     FROM thread_embeddings
     WHERE workspace_id = $1
       AND embedding IS NOT NULL
       AND channel_id = ANY($3::text[])
       AND (
         (embedding <=> $2::vector) < 0.5
         OR content ILIKE $4
       )
     ORDER BY embedding <=> $2::vector
     LIMIT $5`,
    [
      workspaceId,
      JSON.stringify(embedding),
      allowedChannels,
      `%${keyword}%`,
      limit,
    ],
  );
  return rows;
}

// Fetch recent messages for force-save — returns thread_ts for grouping
export async function getRecentChannelMessages(
  workspaceId,
  channelId,
  fromUnix,
) {
  const { rows } = await pool.query(
    `SELECT user_id, text, slack_timestamp, thread_ts
     FROM messages
     WHERE workspace_id = $1
       AND channel_id = $2
       AND deleted = false
       AND slack_timestamp::numeric >= $3
     ORDER BY slack_timestamp ASC`,
    [workspaceId, channelId, fromUnix],
  );
  return rows;
}
