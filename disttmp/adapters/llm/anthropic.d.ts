/**
 * Anthropic LLM Provider（实现 LLMProvider，Anthropic Messages API）
 *
 * 依赖：ANTHROPIC_API_KEY 环境变量
 * 模型：claude-3-5-sonnet-20241022（默认）
 */
import type { LLMOptions, LLMProvider } from '../../core/types.js';
export declare class AnthropicLLM implements LLMProvider {
    private readonly apiKey;
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
    constructor(apiKey?: string);
    complete(prompt: string, opts?: LLMOptions): Promise<string>;
    embed(_text: string): Promise<number[]>;
    ping(): Promise<{
        ok: boolean;
        latency_ms: number;
    }>;
}
