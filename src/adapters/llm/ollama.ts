/**
 * Ollama LLM Provider（实现 LLMProvider，Ollama /api/chat）
 *
 * 依赖：OLLAMA_BASE_URL 环境变量（默认 http://localhost:11434）
 * 模型：qwen2.5（默认）
 * 本地免费，适合开发/测试
 */

import type { LLMOptions, LLMProvider } from '../../core/types.js';
import { fetchWithRetry } from './_retry.js';

export class OllamaLLM implements LLMProvider {
  readonly capabilities = {
    jsonMode: true,
    functionCalling: false,
    vision: false,
    contextWindow: 128_000,
  };

  readonly pricing = {
    inputPerMTok: 0,
    outputPerMTok: 0,
    embedPerMTok: 0,
  };

  constructor(
    private readonly baseUrl: string = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
    private readonly model: string = process.env.OLLAMA_MODEL ?? 'qwen2.5',
  ) {}

  async complete(prompt: string, opts: LLMOptions = {}): Promise<string> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
    };
    if (opts.temperature !== undefined) body.temperature = opts.temperature;
    if (opts.maxTokens) body.options = { num_predict: opts.maxTokens };
    if (opts.stop) body.options = { ...(body.options as object), stop: opts.stop };

    const res = await fetchWithRetry(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Ollama API ${res.status}: ${errText.slice(0, 500)}`);
    }

    const json = await res.json() as { message?: { content?: string } };
    return json.message?.content ?? '';
  }

  async embed(text: string): Promise<number[]> {
    const res = await fetchWithRetry(`${this.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, prompt: text }),
    });
    if (!res.ok) throw new Error(`Ollama embed API ${res.status}`);
    const json = await res.json() as { embedding?: number[] };
    return json.embedding ?? [];
  }

  async ping(): Promise<{ ok: boolean; latency_ms: number }> {
    const t0 = Date.now();
    try {
      await this.complete('ping', { maxTokens: 5 });
      return { ok: true, latency_ms: Date.now() - t0 };
    } catch {
      return { ok: false, latency_ms: Date.now() - t0 };
    }
  }
}