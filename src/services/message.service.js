import { createMessageEntity } from "../models/message.model.js";
import {
  updateMessageText,
  markMessageDeleted,
  insertMessage,
  upsertThreadDirty
} from "../repositories/message.repository.js";
import { awarenessQueue } from "../queues/awareness.queue.js";

export async function handleIncomingMessage(event, body) {
  try {
    // 1️⃣ Normalize external Slack event → internal entity
    const messageEntity = createMessageEntity(event, body);

    // 2️⃣ Persist into database
    const savedMessage = await insertMessage(messageEntity);

    console.log("💾 Message saved with ID:", savedMessage.id);

    console.log("📤 Pushing message to awareness queue:", savedMessage.id);

    await awarenessQueue.add("classify", {
      messageId: savedMessage.id
    });

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