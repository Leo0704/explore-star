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
    inputPerMTok: 3.0,
    outputPerMTok: 15.0,
    embedPerMTok: 0,
  };

  constructor(
    private readonly apiKey: string = process.env.ANTHROPIC_API_KEY ?? '',
    opts: { model?: string } = {},
  ) {
    if (!this.apiKey) throw new Error('AnthropicLLM 需要 ANTHROPIC_API_KEY 环境变量');
    this.model = opts.model ?? 'claude-3-5-sonnet-20241022';
  }

  private readonly model: string;

  async complete(prompt: string, opts: LLMOptions = {}): Promise<string> {
    const parts = prompt.split('\n\n');
    let systemContent: string | undefined;
    let userContent: string;

    if (parts.length >= 2) {
      systemContent = parts[0];
      userContent = parts.slice(1).join('\n\n');
    } else {
      userContent = prompt;
    }

    const body: Record<string, unknown> = {
      model: this.model,
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
    throw new Error(
      'Anthropic does not provide an embedding API; use a dedicated embedding provider (OpenAI or Qwen) for RAG indexing.',
    );
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