import { OpenAIEmbedding } from './openai.js';
import { QwenEmbedding } from './qwen.js';
import { registerEmbedding, listEmbeddings } from '../registry.js';
import { logger } from '../../core/logger.js';

const log = logger.child({ module: 'adapters/embeddings' });

export function registerAll(): void {
  if (process.env.DASHSCOPE_API_KEY) {
    registerEmbedding('qwen', new QwenEmbedding({
      apiKey: process.env.DASHSCOPE_API_KEY,
    }));
  }

  if (process.env.OPENAI_API_KEY) {
    registerEmbedding('openai', new OpenAIEmbedding({
      apiKey: process.env.OPENAI_API_KEY,
    }));
  }

  log.info({ embeddings: listEmbeddings() }, '已注册 Embedding');
}
