import {
  handleIncomingMessage,
  handleMessageEdit,
  handleMessageDelete
} from "../../services/message.service.js";
import { truncateText } from "../../utils/text.utils.js";

export function registerMessage(app) {
  app.event("message", async ({ event, body, client }) => {
    try {

      console.log("📩 Raw event received:", event);

      // Prevent bot loops
      if (event.bot_id) {
        console.log("⛔ Ignoring bot message");
        return;
      }

      // 🧠 Lifecycle routing
      if (event.subtype === "message_changed") {
        console.log("✏️ Message edit detected");
        return await handleMessageEdit(event, body);
      }

      if (event.subtype === "message_deleted") {
        console.log("🗑️ Message delete detected");
        return await handleMessageDelete(event, body);
      }

      if (event.subtype) {
        console.log("⚠️ Ignoring unsupported subtype:", event.subtype);
        return;
      }

      console.log("🆕 New user message:", event.text);

      await handleIncomingMessage(event, body, client);

      // console.log("🤖 Sending bot reply...");


      // const truncatedText = truncateText(event.text);

      // await client.chat.postMessage({
      //   channel: event.channel,
      //   text: `Got it 👍 — "${truncatedText}" has been recorded.`,
      //   thread_ts: event.thread_ts || event.ts
      // });

      // console.log("✅ Bot reply sent successfully");


    } catch (error) {
      console.error("❌ Message processing failed:", error);
    }
  });
}