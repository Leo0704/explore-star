import type { EmbeddingProvider } from '../../core/types.js';

export interface QwenEmbeddingOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  dimensions?: number;
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
