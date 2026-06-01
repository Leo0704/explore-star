/**
 * OpenAI 兼容 LLM Provider
 *
 * 同时实现 OpenAI 和 DeepSeek（两者都是 OpenAI 兼容 API）。
 * V1.4 默认 DeepSeek（国内直连 + 便宜），可降级到 OpenAI/Anthropic/Ollama。
 */
import type { LLMOptions, LLMProvider } from '../../core/types.js';
export interface OpenAICompatibleOptions {
    apiKey: string;
    baseUrl?: string;
    model: string;
    /** 用于日志/计费 */
    displayName?: string;
    /** 定价（美元/百万 token），用于 ROI 估算 */
    pricing?: {
        inputPerMTok: number;
        outputPerMTok: number;
        embedPerMTok?: number;
    };
}
export declare class OpenAICompatibleLLM implements LLMProvider {
    private readonly opts;
    readonly capabilities: {
        jsonMode: boolean;
        functionCalling: boolean;
        vision: boolean;
        contextWindow: number;
    };
    readonly pricing: OpenAICompatibleOptions['pricing'] & {
        inputPerMTok: number;
        outputPerMTok: number;
        embedPerMTok: number;
    };
    constructor(opts: OpenAICompatibleOptions);
    complete(prompt: string, opts?: LLMOptions): Promise<string>;
    embed(text: string): Promise<number[]>;
    ping(): Promise<{
        ok: boolean;
        latency_ms: number;
    }>;
}
