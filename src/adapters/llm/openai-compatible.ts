import type { LLMOptions, LLMProvider } from '../../core/types.js';
import { fetchWithRetry } from './_retry.js';

export interface OpenAICompatibleOptions {
  apiKey: string;
  baseUrl?: string;
  model: string;
  displayName?: string;
  pricing?: { inputPerMTok: number; outputPerMTok: number; embedPerMTok?: number };
}

export class OpenAICompatibleLLM implements LLMProvider {
  private readonly opts: Required<Pick<OpenAICompatibleOptions, 'apiKey' | 'baseUrl' | 'model'>>;

  readonly capabilities = {
    jsonMode: true,
    functionCalling: true,
    vision: false,
    contextWindow: 128_000,
  };

  readonly pricing: OpenAICompatibleOptions['pricing'] & {
    inputPerMTok: number;
    outputPerMTok: number;
    embedPerMTok: number;
  };

  constructor(opts: OpenAICompatibleOptions) {
    if (!opts.apiKey) throw new Error('OpenAICompatibleLLM 需要 apiKey');
    this.opts = {
      apiKey: opts.apiKey,
      baseUrl: opts.baseUrl || (opts.model.startsWith('deepseek') ? 'https://api.deepseek.com/v1' : 'https://api.openai.com/v1'),
      model: opts.model,
    };
    this.pricing = {
      inputPerMTok: opts.pricing?.inputPerMTok ?? 0.15,
      outputPerMTok: opts.pricing?.outputPerMTok ?? 0.6,
      embedPerMTok: opts.pricing?.embedPerMTok ?? 0.02,
    };
  }

  async complete(prompt: string, opts: LLMOptions = {}): Promise<string> {
    const body: Record<string, unknown> = {
      model: this.opts.model,
      messages: [{ role: 'user', content: prompt }],
      temperature: opts.temperature ?? 0.3,
      max_tokens: opts.maxTokens ?? 1000,
    };
    if (opts.responseFormat === 'json') {
      body.response_format = { type: 'json_object' };
    }
    if (opts.stop) body.stop = opts.stop;

    const res = await fetchWithRetry(`${this.opts.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.opts.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`LLM API ${res.status}: ${errText.slice(0, 500)}`);
    }

    const json = await res.json() as { choices: Array<{ message: { content: string } }> };
    return json.choices?.[0]?.message?.content ?? '';
  }

  async embed(text: string): Promise<number[]> {
    const res = await fetchWithRetry(`${this.opts.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.opts.apiKey}`,
      },
      body: JSON.stringify({ model: this.opts.model, input: text }),
    });
    if (!res.ok) throw new Error(`Embed API ${res.status}`);
    const json = await res.json() as { data: Array<{ embedding: number[] }> };
    return json.data[0].embedding;
  }

  async ping(): Promise<{ ok: boolean; latency_ms: number }> {
    const t0 = Date.now();
    try {
      await this.complete('ping', { maxTokens: 5 });
      return { ok: true, latency_ms: Date.now() - t0 };
    } catch (e) {
      return { ok: false, latency_ms: Date.now() - t0 };
    }
  }
}
