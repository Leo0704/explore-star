import { describe, it, expect, vi, beforeEach } from 'vitest';
import { _clearMemoryCache } from '../../src/adapters/llm/_cache.js';
import type { Comment, BusinessProfile } from '../../src/core/types.js';

const mockProfile: BusinessProfile = {
  business: { name: 'Test', value_prop: 'v' },
  target_personas: [
    { id: 'p1', name: 'P1', description: '', typical_pain_points: [] },
  ],
  intent_signals: [],
  buying_stages: [],
  llm: { provider: 'deepseek', model: 'm', api_key_env: 'X' },
  crm: { type: 'feishu', config: {} },
  hook_config: { style: '像朋友推荐', max_length: 30, language: '中文' },
};

function makeComments(n: number, prefix = 'c'): Comment[] {
  return Array.from({ length: n }, (_, i) => ({
    cid: `${prefix}${i}`,
    aweme_id: 'a1',
    video_url: 'https://x',
    video_desc: 'desc',
    keyword: 'k',
    text: `comment text ${prefix}${i}`,
    user: { nickname: 'u', uid: 'u', follower_count: 0, signature: '' },
    digg_count: 0, create_time: '0', reply_count: 0,
  }));
}

function makeLLMResponse() {
  return JSON.stringify(
    Array.from({ length: 10 }, () => ({
      is_target_persona: true,
      persona: 'p1',
      pain_point: 'x',
      intent_score: 0.8,
      buying_stage: 'awareness',
      suggested_reply_hook: 'a',
      suggested_dm_hook: 'b',
    })),
  );
}

describe('analyzeBatch 接入 cache + cost tracker', () => {
  beforeEach(() => {
    _clearMemoryCache();
  });

  it('同输入二次调用,fetcher 计数只 +1(cache 命中)', async () => {
    const fetcher = vi.fn().mockResolvedValue(makeLLMResponse());
    const llm = { complete: fetcher };
    const { analyzeBatch } = await import('../../src/modules/intent-analyzer/batch.js');

    const ctx = {
      profile: mockProfile,
      systemPrompt: 'system-fixed',
      userTplStr: '{{#each comments}}{{cid}}-{{comment_text}}\n{{/each}}',
      llm,
      threshold: 0.7,
    };

    const comments = makeComments(10);
    await analyzeBatch(comments, ctx);
    await analyzeBatch(comments, ctx);

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('不同评论列表不会命中,各调一次', async () => {
    const fetcher = vi.fn().mockResolvedValue(makeLLMResponse());
    const llm = { complete: fetcher };
    const { analyzeBatch } = await import('../../src/modules/intent-analyzer/batch.js');

    const ctx = {
      profile: mockProfile,
      systemPrompt: 'system-fixed',
      userTplStr: '{{#each comments}}{{cid}}-{{comment_text}}\n{{/each}}',
      llm,
      threshold: 0.7,
    };

    const a = makeComments(10, 'a');
    const b = makeComments(10, 'b');
    await analyzeBatch(a, ctx);
    await analyzeBatch(b, ctx);

    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('costTracker 注入后,cache miss 时记录 token', async () => {
    _clearMemoryCache();
    const fetcher = vi.fn().mockResolvedValue(makeLLMResponse());
    const llm = { complete: fetcher };
    const { CostTracker } = await import('../../src/adapters/llm/_cost-tracker.js');
    const { analyzeBatch } = await import('../../src/modules/intent-analyzer/batch.js');

    const mockLLM = {
      pricing: { inputPerMTok: 1, outputPerMTok: 1, embedPerMTok: 0 },
      capabilities: { jsonMode: true, functionCalling: false, vision: false, contextWindow: 1000 },
      async complete() { return makeLLMResponse(); },
      async embed() { return []; },
      async ping() { return { ok: true, latency_ms: 0 }; },
    };
    const tracker = new CostTracker(mockLLM, 'mock');

    const ctx = {
      profile: mockProfile,
      systemPrompt: 'system-fixed',
      userTplStr: '{{#each comments}}{{cid}}-{{comment_text}}\n{{/each}}',
      llm,
      threshold: 0.7,
      costTracker: tracker,
    };

    await analyzeBatch(makeComments(10), ctx);
    const snap = tracker.snapshot();
    expect(snap.call_count).toBe(1);
    expect(snap.prompt_tokens).toBeGreaterThan(0);
    expect(snap.completion_tokens).toBeGreaterThan(0);
  });

  it('costTracker 注入后,cache 命中时不重复计 token', async () => {
    _clearMemoryCache();
    const fetcher = vi.fn().mockResolvedValue(makeLLMResponse());
    const llm = { complete: fetcher };
    const { CostTracker } = await import('../../src/adapters/llm/_cost-tracker.js');
    const { analyzeBatch } = await import('../../src/modules/intent-analyzer/batch.js');

    const mockLLM = {
      pricing: { inputPerMTok: 1, outputPerMTok: 1, embedPerMTok: 0 },
      capabilities: { jsonMode: true, functionCalling: false, vision: false, contextWindow: 1000 },
      async complete() { return makeLLMResponse(); },
      async embed() { return []; },
      async ping() { return { ok: true, latency_ms: 0 }; },
    };
    const tracker = new CostTracker(mockLLM, 'mock');

    const ctx = {
      profile: mockProfile,
      systemPrompt: 'system-fixed',
      userTplStr: '{{#each comments}}{{cid}}-{{comment_text}}\n{{/each}}',
      llm,
      threshold: 0.7,
      costTracker: tracker,
    };

    const comments = makeComments(10);
    await analyzeBatch(comments, ctx);
    const snap1 = tracker.snapshot();
    await analyzeBatch(comments, ctx);
    const snap2 = tracker.snapshot();

    expect(snap2.prompt_tokens).toBe(snap1.prompt_tokens);
    expect(snap2.completion_tokens).toBe(snap1.completion_tokens);
  });
});
