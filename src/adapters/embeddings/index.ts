/**
 * Embedding Provider 索引
 */
import { OpenAIEmbedding } from './openai.js';
import { QwenEmbedding } from './qwen.js';
import { registerEmbedding, listEmbeddings } from '../registry.js';
import { logger } from '../../core/logger.js';

const log = logger.child({ module: 'adapters/embeddings' });

export function registerAll(): void {
  // 国产优先：通义千问（阿里云百炼，新用户有免费额度）
  // 申请：https://bailian.console.aliyun.com/
  if (process.env.DASHSCOPE_API_KEY) {
    registerEmbedding('qwen', new QwenEmbedding({
      apiKey: process.env.DASHSCOPE_API_KEY,
    }));
  }

  // 备选：OpenAI（海外用户）
  if (process.env.OPENAI_API_KEY) {
    registerEmbedding('openai', new OpenAIEmbedding({
      apiKey: process.env.OPENAI_API_KEY,
    }));
  }

  log.info({ embeddings: listEmbeddings() }, '已注册 Embedding');
}
