import { GoogleGenAI } from '@google/genai';
import { config } from '../config/environment.js';

const genAI = new GoogleGenAI({ apiKey: config.geminiApiKey });

export function buildThreadContent(messages, usersMap = {}) {
  return messages
    .filter(msg => msg.text)
    .map(msg => {
      const name = usersMap[msg.user_id] || msg.user_id;
      const ts = msg.slack_timestamp
        ? new Date(parseFloat(msg.slack_timestamp) * 1000).toLocaleString('en-US', {
            month: 'short', day: 'numeric', year: 'numeric',
            hour: 'numeric', minute: '2-digit', hour12: true
          })
        : 'Unknown time';
      return `[${ts}] ${name}: ${msg.text}`;
    })
    .join('\n');
}

export async function generateEmbedding(content) {
  const result = await genAI.models.embedContent({
    model: 'gemini-embedding-001',
    contents: content,
    config: {
      outputDimensionality: 768,
    },
  });
  const embedding = result.embeddings[0].values;
  console.log(`🔢 Embedding generated — ${embedding.length} dimensions`);
  return embedding;
}