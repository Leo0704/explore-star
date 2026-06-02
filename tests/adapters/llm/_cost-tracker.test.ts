/**
 * CostTracker 测试
 *
 * Phase 2 #4:验证 token 估算 + cost 累加 + batch_size 记录
 */

import { describe, it, expect, vi } from 'vitest';
import { CostTracker, estimateTokens } from '../../../src/adapters/llm/_cost-tracker.js';
import type { LLMProvider } from '../../../src/core/types.js';

function makeLLM(
  price: { inputPerMTok: number; outputPerMTok: number; embedPerMTok?: number } = {
    inputPerMTok: 0.14,
    outputPerMTok: 0.28,
    embedPerMTok: 0,
  },
): LLMProvider {
  return {
    pricing: {
      inputPerMTok: price.inputPerMTok,
      outputPerMTok: price.outputPerMTok,
      embedPerMTok: price.embedPerMTok ?? 0,
    },
    capabilities: { jsonMode: true, functionCalling: false, vision: false, contextWindow: 1000 },
    async complete(_prompt: string) {
      return 'fake-response-text';  // 18 字符 → 5 tokens (ceil 18/4)
    },
    async embed() { return []; },
    async ping() { return { ok: true, latency_ms: 0 }; },
  };
}

describe('estimateTokens', () => {
  it('空字符串返回 0', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('1 token ≈ 4 字符(向上取整)', () => {
    expect(estimateTokens('a')).toBe(1);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
    expect(estimateTokens('a'.repeat(100))).toBe(25);
  });
});

describe('CostTracker', () => {
  it('包装 LLM 后 .complete() 返回原 LLM 响应', async () => {
    const llm = makeLLM();
    const tracker = new CostTracker(llm, 'test-llm');
    const out = await tracker.complete('hello');
    expect(out).toBe('fake-response-text');
  });

  it('单次调用累加 prompt + completion tokens', async () => {
    const llm = makeLLM();
    const tracker = new CostTracker(llm, 'test-llm');
    await tracker.complete('a'.repeat(40)); // prompt = 10 tokens
    const snap = tracker.snapshot();
    expect(snap.prompt_tokens).toBe(10);
    expect(snap.completion_tokens).toBe(5);
    expect(snap.call_count).toBe(1);
  });

  it('按 pricing 计算 estimated_cost_usd', async () => {
    const llm = makeLLM({ inputPerMTok: 1.0, outputPerMTok: 2.0, embedPerMTok: 0 });
    const tracker = new CostTracker(llm, 'test-llm');
    await tracker.complete('a'.repeat(4000)); // 1000 prompt tokens
    // response 18 chars / 4 = 5 completion tokens
    // cost = (1000/1e6)*1 + (5/1e6)*2 = 0.001 + 0.00001 = 0.00101
    const snap = tracker.snapshot();
    expect(snap.estimated_cost_usd).toBeCloseTo(0.00101, 5);
  });

  it('多次调用累加 prompt + completion tokens', async () => {
    const llm = makeLLM();
    const tracker = new CostTracker(llm, 'test-llm');
    await tracker.complete('a'.repeat(40));
    await tracker.complete('b'.repeat(80));
    const snap = tracker.snapshot();
    expect(snap.prompt_tokens).toBe(30);
    expect(snap.completion_tokens).toBe(10);
    expect(snap.call_count).toBe(2);
  });

  it('recordBatchSize 累计 batch_sizes', () => {
    const llm = makeLLM();
    const tracker = new CostTracker(llm, 'test-llm');
    tracker.recordBatchSize(10);
    tracker.recordBatchSize(8);
    const snap = tracker.snapshot();
    expect(snap.batch_sizes).toEqual([10, 8]);
  });

  it('recordCacheHit 计数 +1 但不计 token', () => {
    const llm = makeLLM();
    const tracker = new CostTracker(llm, 'test-llm');
    tracker.recordCacheHit();
    tracker.recordCacheHit();
    const snap = tracker.snapshot();
    expect(snap.call_count).toBe(2);
    expect(snap.prompt_tokens).toBe(0);
    expect(snap.completion_tokens).toBe(0);
    expect(snap.estimated_cost_usd).toBe(0);
  });

  it('recordUsage 不实际调 LLM(纯累加)', () => {
    const llm = makeLLM();
    const tracker = new CostTracker(llm, 'test-llm');
    tracker.recordUsage('a'.repeat(80), 'b'.repeat(20));
    const snap = tracker.snapshot();
    expect(snap.prompt_tokens).toBe(20);
    expect(snap.completion_tokens).toBe(5);
    expect(snap.call_count).toBe(1);
  });

  it('snapshot 是快照,后续累加不影响已取快照', async () => {
    const llm = makeLLM();
    const tracker = new CostTracker(llm, 'test-llm');
    await tracker.complete('a'.repeat(40));
    const snap1 = tracker.snapshot();
    await tracker.complete('a'.repeat(40));
    const snap2 = tracker.snapshot();
    expect(snap1.prompt_tokens).toBe(10);
    expect(snap2.prompt_tokens).toBe(20);
  });
});
