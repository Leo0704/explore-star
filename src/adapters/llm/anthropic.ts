/**
 * Anthropic LLM Provider（实现 LLMProvider，Anthropic Messages API）
 *
 * 依赖：ANTHROPIC_API_KEY 环境变量
 * 模型：claude-3-5-sonnet-20241022（默认）
 */

import type { LLMOptions, LLMProvider } from '../../core/types.js';
import { fetchWithRetry } from './_retry.js';

export class AnthropicLLM implements LLMProvider {
  readonly capabilities = {
    jsonMode: true,
    functionCalling: true,
    vision: true,
    contextWindow: 200_000,
  };

  readonly pricing = {
    inputPerMTok: 3.0,    // claude-3-5-sonnet
    outputPerMTok: 15.0,
    embedPerMTok: 0,
  };

  constructor(private readonly apiKey: string = process.env.ANTHROPIC_API_KEY ?? '') {
    if (!this.apiKey) throw new Error('AnthropicLLM 需要 ANTHROPIC_API_KEY 环境变量');
  }

  async complete(prompt: string, opts: LLMOptions = {}): Promise<string> {
    // 从 prompt 中提取 system prompt（约定：systemPrompt \n\n userPrompt \n\n ...)
    // batch.ts 使用此约定，intent-analyzer 跨 batch 的 system 完全不变，适合 caching
    const parts = prompt.split('\n\n');
    let systemContent: string | undefined;
    let userContent: string;

    if (parts.length >= 2) {
      systemContent = parts[0];
      userContent = parts.slice(1).join('\n\n');
    } else {
      // 没有 \n\n 约定时，整条作为 user message（向后兼容）
      userContent = prompt;
    }

    const body: Record<string, unknown> = {
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: opts.maxTokens ?? 1000,
      messages: [{ role: 'user', content: userContent }],
    };
    if (systemContent) {
      body.system = [
        {
          type: 'text',
          text: systemContent,
          cache_control: { type: 'ephemeral' },
        },
      ];
    }
    if (opts.temperature !== undefined) body.temperature = opts.temperature;
    if (opts.stop) body.stop_sequences = opts.stop;

    const res = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Anthropic API ${res.status}: ${errText.slice(0, 500)}`);
    }

    const json = await res.json() as { content: Array<{ type: string; text?: string }> };
    const textContent = json.content?.find(c => c.type === 'text');
    return textContent?.text ?? '';
  }

  async embed(_text: string): Promise<number[]> {
    // Anthropic 目前没有 embedding 接口，降级到 0 向量
    return Array(1536).fill(0);
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