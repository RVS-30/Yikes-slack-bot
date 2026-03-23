import { GoogleGenAI } from '@google/genai';
import { config } from '../config/environment.js';

const genAI = new GoogleGenAI({ apiKey: config.geminiApiKey });

export async function classifyMessage(text) {
    console.log("🧠 classifyMessage triggered");
    console.log("📩 Incoming message:", text);

    if (!text || text.length < 3) {
        console.log("⚠️ Message too short — skipping AI classification");
        return {
            message_type: "conversation",
            importance_score: 0.1,
            entities: [],
            topic_tags: []
        };
    }

    const prompt = `
Classify the Slack message.

Return ONLY valid JSON.

Message Types:
decision
task
question
information
conversation

Extract:
message_type
importance_score (0-1)
entities (keywords)
topic_tags (topics)

Message:
"${text}"

Return format:
{
"message_type":"",
"importance_score":0,
"entities":[],
"topic_tags":[]
}
`;

    try {
        console.log("🚀 Sending request to Gemini...");

        const result = await genAI.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
        });

        const response = result.text;
        console.log("🤖 Gemini raw response:", response);

        const clean = response
            .replace(/```json/g, "")
            .replace(/```/g, "")
            .trim();

        const parsed = JSON.parse(clean);
        console.log("✅ Parsed classification:", parsed);
        return parsed;

    } catch (error) {
        console.error("❌ Gemini classification failed:", error);
        return {
            message_type: "conversation",
            importance_score: 0.1,
            entities: [],
            topic_tags: []
        };
    }
}