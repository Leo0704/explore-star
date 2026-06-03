import { OpenAICompatibleLLM } from './openai-compatible.js';
import { registerLLM, listLLMs } from '../registry.js';
import { AnthropicLLM } from './anthropic.js';
import { OllamaLLM } from './ollama.js';
import { logger } from '../../core/logger.js';

const log = logger.child({ module: 'adapters/llm' });

export function registerAll(): void {
  if (process.env.DEEPSEEK_API_KEY) {
    registerLLM('deepseek', new OpenAICompatibleLLM({
      apiKey: process.env.DEEPSEEK_API_KEY,
      model: process.env.DEEPSEEK_MODEL || 'deepseek-v3',
      pricing: { inputPerMTok: 0.14, outputPerMTok: 0.28 },
    }));
  }

  if (process.env.OPENAI_API_KEY) {
    registerLLM('openai', new OpenAICompatibleLLM({
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      pricing: { inputPerMTok: 0.15, outputPerMTok: 0.6 },
    }));
  }

  if (process.env.ANTHROPIC_API_KEY) {
    registerLLM('anthropic', new AnthropicLLM(process.env.ANTHROPIC_API_KEY));
  }

  registerLLM('ollama', new OllamaLLM(
    process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
    process.env.OLLAMA_MODEL || 'qwen2.5',
  ));

  if (process.env.CUSTOM_API_KEY) {
    registerLLM('custom', new OpenAICompatibleLLM({
      apiKey: process.env.CUSTOM_API_KEY,
      baseUrl: process.env.CUSTOM_BASE_URL,
      model: process.env.CUSTOM_MODEL || 'gpt-4o-mini',
      displayName: process.env.CUSTOM_MODEL || 'custom',
    }));
  }

  log.info({ llms: listLLMs() }, '已注册 LLM');
}
