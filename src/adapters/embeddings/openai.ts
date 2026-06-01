/**
 * OpenAI Embedding Provider（V1.4 独立实现）
 *
 * 不复用 LLM 抽象（embeddings 有不同的 input/response 形状）
 */

import type { EmbeddingProvider } from '../../core/types.js';

export interface OpenAIEmbeddingOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;             // 默认 text-embedding-3-small
}

export class OpenAIEmbedding implements EmbeddingProvider {
  readonly dimensions: number;
  readonly model: string;

  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(opts: OpenAIEmbeddingOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl || 'https://api.openai.com/v1';
    this.model = opts.model || 'text-embedding-3-small';
    this.dimensions = this.model === 'text-embedding-3-small' ? 1536 : 1536;
  }

  async embed(text: string): Promise<number[]> {
    const result = await this.embedBatch([text]);
    return result[0];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const res = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, input: texts }),
    });
    if (!res.ok) {
      throw new Error(`OpenAI Embeddings API ${res.status}: ${await res.text()}`);
    }
    const json = (await res.json()) as { data: Array<{ embedding: number[] }> };
    return json.data.map(d => d.embedding);
  }
}
