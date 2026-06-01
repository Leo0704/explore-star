/**
 * OpenAI Embedding Provider（V1.4 独立实现）
 *
 * 不复用 LLM 抽象（embeddings 有不同的 input/response 形状）
 */
import type { EmbeddingProvider } from '../../core/types.js';
export interface OpenAIEmbeddingOptions {
    apiKey: string;
    baseUrl?: string;
    model?: string;
}
export declare class OpenAIEmbedding implements EmbeddingProvider {
    readonly dimensions: number;
    readonly model: string;
    private readonly apiKey;
    private readonly baseUrl;
    constructor(opts: OpenAIEmbeddingOptions);
    embed(text: string): Promise<number[]>;
    embedBatch(texts: string[]): Promise<number[][]>;
}
