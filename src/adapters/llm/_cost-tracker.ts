/**
 * LLM 成本埋点
 *
 * 包装 LLMProvider 累加 token + cost。token 用字符长度粗估（1 token ≈ 4 字符）——
 * 真实 token 数等 provider 升级返回 usage 后切换（Phase 4 候选）。
 *
 * Phase 2 #4 (roadmap §2.4):
 *   - 在 run-daily 顶层创建 CostTracker
 *   - 注入到 batch.ts 的 BatchContext
 *   - run-daily finally 块读 snapshot 写 cost_estimate 到 run_history.jsonl
 */

import type { LLMProvider } from '../../core/types.js';

/**
 * 估算 token 数:1 token ≈ 4 字符（中英文混合经验值，参考 OpenAI tiktoken）
 * 向上取整避免 0 token 漏算
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export interface CostSnapshot {
  prompt_tokens: number;
  completion_tokens: number;
  estimated_cost_usd: number;
  /** 每次 LLM 调用的 batch 大小(供未来 P50/P95 统计) */
  batch_sizes: number[];
  /** 调 LLM 次数(含 cache miss + cache hit) */
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

  /**
   * 完整包装 LLMProvider.complete —— 调 LLM + 自动累加 token/cost
   * 用于 cache miss 场景
   */
  async complete(prompt: string, opts?: Parameters<LLMProvider['complete']>[1]): Promise<string> {
    const response = await this.llm.complete(prompt, opts);
    this.recordUsage(prompt, response);
    return response;
  }

  /**
   * 仅累加 token/cost,不实际调 LLM
   * 用于:cache miss 时外部调了 LLM 后,把 (prompt, response) 喂给 tracker
   */
  recordUsage(prompt: string, response: string): void {
    const p = estimateTokens(prompt);
    const c = estimateTokens(response);
    this.prompt_tokens += p;
    this.completion_tokens += c;
    this.estimated_cost_usd += this.costFor(p, c);
    this.call_count += 1;
  }

  /**
   * 记录一次 cache 命中(不调 LLM、不产 token,但 call_count +1)
   * 用于:cache 命中时让分母(call_count)反映"实际请求次数"
   */
  recordCacheHit(): void {
    this.call_count += 1;
  }

  /** 记录一个 batch 的实际大小(供未来 P50/P95 分析) */
  recordBatchSize(size: number): void {
    this.batch_sizes.push(size);
  }

  /** 读取当前快照(返回新对象,后续累加不影响) */
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
