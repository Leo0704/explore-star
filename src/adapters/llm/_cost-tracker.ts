import type { LLMProvider } from '../../core/types.js';

export function estimateTokens(text: string): number {
  if (!text) return 0;
  const cjkCount = (text.match(/[一-鿿぀-ヿ]/g) || []).length;
  const otherCount = text.length - cjkCount;
  return Math.ceil(cjkCount * 1.5 + otherCount / 4);
}

export interface CostSnapshot {
  prompt_tokens: number;
  completion_tokens: number;
  estimated_cost_usd: number;
  batch_sizes: number[];
  call_count: number;
}

export class CostTracker {
  private prompt_tokens = 0;
  private completion_tokens = 0;
  private estimated_cost_usd = 0;
  private batch_sizes: number[] = [];
  private call_count = 0;

  constructor(
    private readonly llm: LLMProvider,
    public readonly llmName: string,
  ) {}

  async complete(prompt: string, opts?: Parameters<LLMProvider['complete']>[1]): Promise<string> {
    const response = await this.llm.complete(prompt, opts);
    this.recordUsage(prompt, response);
    return response;
  }

  recordUsage(prompt: string, response: string): void {
    const p = estimateTokens(prompt);
    const c = estimateTokens(response);
    this.prompt_tokens += p;
    this.completion_tokens += c;
    this.estimated_cost_usd += this.costFor(p, c);
    this.call_count += 1;
  }

  recordCacheHit(): void {
    this.call_count += 1;
  }

  recordBatchSize(size: number): void {
    this.batch_sizes.push(size);
  }

  snapshot(): CostSnapshot {
    return {
      prompt_tokens: this.prompt_tokens,
      completion_tokens: this.completion_tokens,
      estimated_cost_usd: this.estimated_cost_usd,
      batch_sizes: [...this.batch_sizes],
      call_count: this.call_count,
    };
  }

  private costFor(p: number, c: number): number {
    const pricing = this.llm.pricing;
    return (p / 1_000_000) * pricing.inputPerMTok + (c / 1_000_000) * pricing.outputPerMTok;
  }
}
