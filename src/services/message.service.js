import { createMessageEntity } from "../models/message.model.js";
import {
  updateMessageText,
  markMessageDeleted,
  insertMessage,
  upsertThreadDirty,
  upsertUser
} from "../repositories/message.repository.js";
import { awarenessQueue } from "../queues/awareness.queue.js";

async function resolveAndCacheUser(client, workspaceId, userId) {
  try {
    const res = await client.users.info({ user: userId });
    const profile = res.user?.profile;
    const displayName =
      profile?.display_name ||
      profile?.real_name ||
      res.user?.name ||
      userId;
    const avatarUrl = profile?.image_48 || null;
    await upsertUser(workspaceId, userId, displayName, avatarUrl);
  } catch (err) {
    console.warn(`⚠️ Could not resolve user ${userId}:`, err.message);
    // Non-fatal — message flow continues even if name resolution fails
  }
}

export async function handleIncomingMessage(event, body, client) {
  try {
    const messageEntity = createMessageEntity(event, body);
    const savedMessage = await insertMessage(messageEntity);
    console.log("💾 Message saved with ID:", savedMessage.id);

    // Resolve + cache user in background — non-blocking
    if (event.user && body.team_id) {
      resolveAndCacheUser(client, body.team_id, event.user);
    }

    console.log("📤 Pushing message to awareness queue:", savedMessage.id);
    await awarenessQueue.add("classify", { messageId: savedMessage.id });
    console.log("✅ Job added to awareness queue");

    return savedMessage;
  } catch (error) {
    console.error("❌ Failed to handle incoming message:", error);
    throw error;
  }
}

export async function handleMessageEdit(event, body) {
  try {
    const edited = event.message;
    if (!edited?.ts) return;
    if (!edited?.edited) return;

    const updatedMessage = await updateMessageText({
      workspace_id: body.team_id,
      channel_id: event.channel,
      slack_timestamp: edited.ts,
      text: edited.text,
      raw_payload: body
    });

    console.log("✏️ Message edited:", edited.ts);

    if (updatedMessage?.thread_ts) {
      await upsertThreadDirty(body.team_id, event.channel, updatedMessage.thread_ts);
      console.log("🧵 Thread marked dirty after edit:", updatedMessage.thread_ts);
    }

    return updatedMessage;
  } catch (error) {
    console.error("❌ Failed to process message edit:", error);
    throw error;
  }
}

export async function handleMessageDelete(event, body) {
  try {
    const deletedMessage = await markMessageDeleted({
      workspace_id: body.team_id,
      channel_id: event.channel,
      slack_timestamp: event.previous_message?.ts
    });

    console.log("🗑️ Message deleted:", event.previous_message?.ts);

    if (deletedMessage?.thread_ts) {
      await upsertThreadDirty(body.team_id, event.channel, deletedMessage.thread_ts);
      console.log("🧵 Thread marked dirty after delete:", deletedMessage.thread_ts);
    }

    return deletedMessage;
  } catch (error) {
    console.error("❌ Failed to process message delete:", error);
    throw error;
  }
}