/**
 * Embedding Provider 索引
 */
import { OpenAIEmbedding } from './openai.js';
import { registerEmbedding, listEmbeddings } from '../registry.js';

export function registerAll(): void {
  if (process.env.OPENAI_API_KEY) {
    registerEmbedding('openai', new OpenAIEmbedding({
      apiKey: process.env.OPENAI_API_KEY,
    }));
  }
  // V2: DeepSeek / 本地 bge / ollama

  console.log(`[adapters/embeddings] 已注册：${listEmbeddings().join(', ') || '（无 — 请设置 OPENAI_API_KEY）'}`);
}
