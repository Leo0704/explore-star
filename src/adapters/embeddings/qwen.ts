/**
 * 通义千问 Embedding Provider（Q1）
 *
 * 阿里云 DashScope 的 OpenAI 兼容接口（/compatible-mode/v1/embeddings）。
 * 与 openai.ts 同样的请求/响应形状，区别只在 baseUrl + model。
 *
 * 默认模型：text-embedding-v3（1024 维）。
 *   - 也可选 v2（1536 维，跟 OpenAI 同维度）
 *   - v3 支持 512/768/1024 三种维度（通过 dimensions 参数）
 *
 * API key 环境变量：DASHSCOPE_API_KEY
 * 申请地址：https://bailian.console.aliyun.com/
 */

import type { EmbeddingProvider } from '../../core/types.js';

export interface QwenEmbeddingOptions {
  apiKey: string;
  baseUrl?: string;          // 默认 https://dashscope.aliyun.com/compatible-mode/v1
  model?: string;            // 默认 text-embedding-v3
  dimensions?: number;       // 默认 1024（v3 唯一原生支持的 1024 维）
}

export class QwenEmbedding implements EmbeddingProvider {
  readonly dimensions: number;
  readonly model: string;

  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(opts: QwenEmbeddingOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? 'https://dashscope.aliyun.com/compatible-mode/v1').replace(/\/+$/, '');
    this.model = opts.model ?? 'text-embedding-v3';
    this.dimensions = opts.dimensions ?? 1024;
  }

  async embed(text: string): Promise<number[]> {
    const result = await this.embedBatch([text]);
    return result[0];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const res = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
        dimensions: this.dimensions,
      }),
    });

    if (!res.ok) {
      throw new Error(`通义 Embeddings API ${res.status}: ${await res.text()}`);
    }

    const json = (await res.json()) as { data: Array<{ embedding: number[] }> };
    return json.data.map(d => d.embedding);
  }
}
