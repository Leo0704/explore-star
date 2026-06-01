/**
 * LLM Adapters 索引
 */
import { OpenAICompatibleLLM } from './openai-compatible.js';
import { registerLLM, listLLMs } from '../registry.js';
import { AnthropicLLM } from './anthropic.js';
import { OllamaLLM } from './ollama.js';
export function registerAll() {
    // DeepSeek (V1.4 默认)
    if (process.env.DEEPSEEK_API_KEY) {
        registerLLM('deepseek', new OpenAICompatibleLLM({
            apiKey: process.env.DEEPSEEK_API_KEY,
            model: process.env.DEEPSEEK_MODEL || 'deepseek-v3',
            pricing: { inputPerMTok: 0.14, outputPerMTok: 0.28 },
        }));
    }
    // OpenAI
    if (process.env.OPENAI_API_KEY) {
        registerLLM('openai', new OpenAICompatibleLLM({
            apiKey: process.env.OPENAI_API_KEY,
            model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
            pricing: { inputPerMTok: 0.15, outputPerMTok: 0.6 },
        }));
    }
    // Anthropic
    if (process.env.ANTHROPIC_API_KEY) {
        registerLLM('anthropic', new AnthropicLLM(process.env.ANTHROPIC_API_KEY));
    }
    // Ollama（本地免费）
    registerLLM('ollama', new OllamaLLM(process.env.OLLAMA_BASE_URL || 'http://localhost:11434', process.env.OLLAMA_MODEL || 'qwen2.5'));
    console.log(`[adapters/llm] 已注册：${listLLMs().join(', ') || '（无 — 请设置 DEEPSEEK_API_KEY 或 OPENAI_API_KEY）'}`);
}
export { OpenAICompatibleLLM } from './openai-compatible.js';
//# sourceMappingURL=index.js.map