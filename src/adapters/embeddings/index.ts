/**
 * Embedding Provider 索引
 */
import { OpenAIEmbedding } from './openai.js';
import { registerEmbedding, listEmbeddings } from '../registry.js';
import { logger } from '../../core/logger.js';

const log = logger.child({ module: 'adapters/embeddings' });

export function registerAll(): void {
  if (process.env.OPENAI_API_KEY) {
    registerEmbedding('openai', new OpenAIEmbedding({
      apiKey: process.env.OPENAI_API_KEY,
    }));
  }
  // V2: DeepSeek / 本地 bge / ollama

  log.info({ embeddings: listEmbeddings() }, '已注册 Embedding');
}
