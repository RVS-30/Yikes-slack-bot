import { classifyMessage } from "../services/awareness.service.js";
import { getMessageById, updateMessageEnrichment, upsertThreadDirty } from "../repositories/message.repository.js";

export async function runAwarenessWorker(jobData) {
  const { messageId } = jobData;

  if (!messageId) {
    console.warn("⚠️ No messageId in job data — skipping");
    return;
  }

  console.log(`🧠 Processing message: ${messageId}`);

  const msg = await getMessageById(messageId);

  if (!msg) {
    console.log(`⚠️ Message ${messageId} not found or already processed — skipping`);
    return;
  }

  const awareness = await classifyMessage(msg.text);

  await updateMessageEnrichment(msg.id, awareness);

  if (msg.thread_ts) {
    await upsertThreadDirty(msg.workspace_id, msg.channel_id, msg.thread_ts);
    console.log(`🧵 Thread upserted as dirty: ${msg.thread_ts}`);
  }

  console.log("✅ Processed message:", msg.id);
}