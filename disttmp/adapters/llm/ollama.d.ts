/**
 * Ollama LLM Provider（实现 LLMProvider，Ollama /api/chat）
 *
 * 依赖：OLLAMA_BASE_URL 环境变量（默认 http://localhost:11434）
 * 模型：qwen2.5（默认）
 * 本地免费，适合开发/测试
 */
import type { LLMOptions, LLMProvider } from '../../core/types.js';
export declare class OllamaLLM implements LLMProvider {
    private readonly baseUrl;
    private readonly model;
    readonly capabilities: {
        jsonMode: boolean;
        functionCalling: boolean;
        vision: boolean;
        contextWindow: number;
    };
    readonly pricing: {
        inputPerMTok: number;
        outputPerMTok: number;
        embedPerMTok: number;
    };
    constructor(baseUrl?: string, model?: string);
    complete(prompt: string, opts?: LLMOptions): Promise<string>;
    embed(text: string): Promise<number[]>;
    ping(): Promise<{
        ok: boolean;
        latency_ms: number;
    }>;
}
