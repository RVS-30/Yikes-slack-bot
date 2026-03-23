import { GoogleGenAI } from '@google/genai';
import { config } from '../config/environment.js';

const genAI = new GoogleGenAI({ apiKey: config.geminiApiKey });

export function buildThreadContent(messages) {
  return messages
    .map(msg => msg.text)
    .filter(Boolean)
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