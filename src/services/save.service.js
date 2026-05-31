import { resolveAccessibleChannels } from './membership.service.js';
import {
  getRecentChannelMessages,
  getThreadMessages,
  getUsersByIds,
  upsertThreadEmbedding,
} from '../repositories/message.repository.js';
import { buildThreadContent, generateEmbedding } from './embedding.service.js';

function parseSlackUrl(url) {
  const match = url.match(/archives\/(C[A-Z0-9]+)\/p(\d+)/);
  if (!match) throw new Error('Invalid Slack message link.');
  const channelId = match[1];
  const raw = match[2];
  const threadTs = `${raw.slice(0, 10)}.${raw.slice(10)}`;
  return { channelId, threadTs };
}

// /memory save <link> — force-embed a specific thread
export async function saveThread(workspaceId, userId, url, client) {
  const { channelId, threadTs } = parseSlackUrl(url);

  const accessible = await resolveAccessibleChannels(client, workspaceId, userId);
  if (!accessible.includes(channelId)) {
    throw new Error("You don't have access to that channel.");
  }

  const messages = await getThreadMessages(workspaceId, channelId, threadTs);
  if (messages.length === 0) {
    throw new Error('No messages found. Thread may not be ingested yet.');
  }

  const userIds = [...new Set(messages.map((m) => m.user_id).filter(Boolean))];
  const usersMap = await getUsersByIds(workspaceId, userIds);
  const content = buildThreadContent(messages, usersMap);
  const embedding = await generateEmbedding(content);

  await upsertThreadEmbedding(workspaceId, channelId, threadTs, content, embedding, messages.length);

  return { threadCount: 1, messageCount: messages.length };
}

// /memory save — force-embed last 30 min of current channel
export async function saveChannel(workspaceId, userId, channelId, client) {
  const accessible = await resolveAccessibleChannels(client, workspaceId, userId);
  if (!accessible.includes(channelId)) {
    throw new Error("You don't have access to this channel.");
  }

  const fromUnix = (Date.now() / 1000) - 30 * 60;
  const messages = await getRecentChannelMessages(workspaceId, channelId, fromUnix);

  if (messages.length === 0) {
    throw new Error('No messages in the last 30 minutes to save.');
  }

  // Group by thread_ts — each group is one embedding unit
  const threadMap = new Map();
  for (const msg of messages) {
    if (!threadMap.has(msg.thread_ts)) threadMap.set(msg.thread_ts, []);
    threadMap.get(msg.thread_ts).push(msg);
  }

  let embeddedThreads = 0;
  let totalMessages = 0;

  for (const [threadTs, threadMessages] of threadMap) {
    const userIds = [...new Set(threadMessages.map((m) => m.user_id).filter(Boolean))];
    const usersMap = await getUsersByIds(workspaceId, userIds);
    const content = buildThreadContent(threadMessages, usersMap);
    const embedding = await generateEmbedding(content);

    await upsertThreadEmbedding(workspaceId, channelId, threadTs, content, embedding, threadMessages.length);

    embeddedThreads++;
    totalMessages += threadMessages.length;
  }

  return { threadCount: embeddedThreads, messageCount: totalMessages };
}