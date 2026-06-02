# Phase 2 #4 · LLM 成本优化 · TDD 实施计划

> **上游 spec：** `docs/superpowers/specs/2026-06-03-phase-2-llm-cost-optimization-design.md`
> **基线分支：** `feat/phase-2-llm-cost-optimization`（从 main 切出）
> **测试栈：** vitest（既有）

---

## File Structure

| 文件 | 责任 | 新增/改 | 行数估计 |
|---|---|---|---|
| `src/adapters/llm/_cache.ts`（改） | TTL 7 天过滤 | 改 | +20 |
| `src/adapters/llm/_cost-tracker.ts`（新） | `CostTracker` 包装类 + token 估算 | 新 | ~120 |
| `src/modules/intent-analyzer/batch.ts`（改） | 接入 `completeWithCache` + CostTracker 包装 | 改 | +25 |
| `src/orchestration/run-daily.ts`（改） | 跑 cost 累加 + 落 history | 改 | +15（不破坏 finally 结构）|
| `src/cli/insights.ts`（改） | 加 cost summary 页面 | 改 | +60 |
| `src/cli/cache-bust.ts`（新） | `cache-bust` 子命令 | 新 | ~50 |
| `src/cli/index.ts`（改） | 注册 `cache-bust` | 改 | +3 |
| `src/adapters/llm/index.ts`（改） | deepseek pricing 单位统一（已 USD/MTok）| 改 | 0（确认无需改）|
| `tests/adapters/llm/_cache.test.ts`（改） | 加 TTL 测试 | 改 | +50 |
| `tests/adapters/llm/_cost-tracker.test.ts`（新） | CostTracker 单元 | 新 | ~150 |
| `tests/modules/intent-analyzer-cache.test.ts`（新） | analyzeBatch 接 cache | 新 | ~120 |
| `tests/orchestration/run-daily-cost.test.ts`（新） | run_history 含 cost_estimate | 新 | ~120 |
| `tests/cli/insights-cost.test.ts`（新） | insights 加 cost 段落 | 新 | ~80 |
| `tests/cli/cache-bust.test.ts`（新） | cache-bust 清空 | 新 | ~50 |

---

## Task 1：`_cache.ts` 加 TTL 7 天（先写失败测试）

### 1.1 写测试

在 `tests/adapters/llm/_cache.test.ts` 末尾 `describe` 块加：

```typescript
describe('cache TTL（7 天硬上限）', () => {
  it('新写入的 entry 立即可命中', async () => {
    const key = buildCacheKey('m', 's', 'u-ttl-1');
    await cacheSet(key, {
      response: 'fresh',
      createdAt: new Date().toISOString(),
      model: 'm',
      promptHash: key,
    });
    const got = await cacheGet(key, 'm');
    expect(got?.response).toBe('fresh');
  });

  it('超过 7 天的 entry 视为过期,返回 null', async () => {
    const key = buildCacheKey('m', 's', 'u-ttl-2');
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    await cacheSet(key, {
      response: 'stale',
      createdAt: eightDaysAgo.toISOString(),
      model: 'm',
      promptHash: key,
    });
    const got = await cacheGet(key, 'm');
    expect(got).toBeNull();
  });

  it('6 天前的 entry 仍然命中（在 TTL 内）', async () => {
    const key = buildCacheKey('m', 's', 'u-ttl-3');
    const sixDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
    await cacheSet(key, {
      response: 'ok',
      createdAt: sixDaysAgo.toISOString(),
      model: 'm',
      promptHash: key,
    });
    const got = await cacheGet(key, 'm');
    expect(got?.response).toBe('ok');
  });
});
```

### 1.2 跑测试 —— 必须 fail

```bash
npx vitest run tests/adapters/llm/_cache.test.ts -t "TTL"
```

期望：第二个测试 fail（"超过 7 天的 entry" 期望 null 但得到 stale）。

### 1.3 实现

改 `src/adapters/llm/_cache.ts`：
- 加 `const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;`
- `cacheGet` 命中后第一步：`if (Date.now() - new Date(entry.createdAt).getTime() > CACHE_TTL_MS) return null;`
- 内存路径和 disk fallback 路径都加
- disk 命中后**也删内存**避免复活：`memoryCache.delete(key)`

### 1.4 验证

```bash
npx vitest run tests/adapters/llm/_cache.test.ts -t "TTL"
```

期望：3 个测试全通过。

---

## Task 2：新建 `_cost-tracker.ts`（先写失败测试）

### 2.1 写测试

`tests/adapters/llm/_cost-tracker.test.ts`：

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CostTracker, estimateTokens } from '../../../src/adapters/llm/_cost-tracker.js';
import type { LLMProvider } from '../../../src/core/types.js';

function makeLLM(price = { inputPerMTok: 0.14, outputPerMTok: 0.28, embedPerMTok: 0 }): LLMProvider {
  return {
    pricing: price,
    capabilities: { jsonMode: true, functionCalling: false, vision: false, contextWindow: 1000 },
    async complete(prompt: string) { return 'fake-response-text'; },
    async embed() { return []; },
    async ping() { return { ok: true, latency_ms: 0 }; },
  };
}

describe('estimateTokens', () => {
  it('中英文混合: 1 token ≈ 4 字符', () => {
    expect(estimateTokens('hello world')).toBe(3); // 11/4 ceil = 3
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('a'.repeat(100))).toBe(25); // 100/4 = 25
  });
});

describe('CostTracker', () => {
  beforeEach(() => {
    // CostTracker 是单例（内部 Map），测试间需重置
    // 通过 setPricing 或暴露 reset hook
  });

  it('包装 LLM 后 .complete() 返回原文', async () => {
    const llm = makeLLM();
    const tracker = new CostTracker(llm, 'test-llm');
    const out = await tracker.complete('hello');
    expect(out).toBe('fake-response-text');
  });

  it('单次调用累加 prompt + completion tokens', async () => {
    const llm = makeLLM();
    const tracker = new CostTracker(llm, 'test-llm');
    await tracker.complete('a'.repeat(40)); // prompt = 10 tokens
    // response = 'fake-response-text' = 18 chars / 4 = 5 tokens (ceil)
    const snap = tracker.snapshot();
    expect(snap.prompt_tokens).toBe(10);
    expect(snap.completion_tokens).toBe(5);
  });

  it('按 pricing 计算 estimated_cost_usd', async () => {
    const llm = makeLLM({ inputPerMTok: 1.0, outputPerMTok: 2.0, embedPerMTok: 0 });
    const tracker = new CostTracker(llm, 'test-llm');
    await tracker.complete('a'.repeat(4000)); // 1000 tokens
    // response 18 chars / 4 = 5 tokens
    // cost = (1000/1e6)*1 + (5/1e6)*2 = 0.001 + 0.00001 = 0.00101
    const snap = tracker.snapshot();
    expect(snap.estimated_cost_usd).toBeCloseTo(0.00101, 5);
  });

  it('多次调用累加', async () => {
    const llm = makeLLM();
    const tracker = new CostTracker(llm, 'test-llm');
    await tracker.complete('a'.repeat(40));
    await tracker.complete('b'.repeat(80));
    const snap = tracker.snapshot();
    expect(snap.prompt_tokens).toBe(30); // 10 + 20
  });

  it('snapshot 累计 batch_size（外部传）', () => {
    const llm = makeLLM();
    const tracker = new CostTracker(llm, 'test-llm');
    tracker.recordBatchSize(10);
    tracker.recordBatchSize(8);
    const snap = tracker.snapshot();
    expect(snap.batch_sizes).toEqual([10, 8]);
  });
});
```

### 2.2 跑测试 —— 必须 fail

```bash
npx vitest run tests/adapters/llm/_cost-tracker.test.ts
```

期望：全部 fail（模块不存在）。

### 2.3 实现

新建 `src/adapters/llm/_cost-tracker.ts`：

```typescript
/**
 * LLM 成本埋点
 *
 * 包装 LLMProvider 累加 token + cost。token 用字符长度粗估（1 token ≈ 4 字符）。
 * 真实 token 数等 provider 升级返回 usage 后切换。
 */

import type { LLMProvider } from '../../core/types.js';

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
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

  /** 记录一次 LLM 调用的 token + cost（不实际调 LLM）—— 供 cache 命中场景用 */
  recordUsage(prompt: string, response: string): void {
    const p = estimateTokens(prompt);
    const c = estimateTokens(response);
    this.prompt_tokens += p;
    this.completion_tokens += c;
    this.estimated_cost_usd += this.costFor(p, c);
    this.call_count += 1;
  }

  /** 记录 cache 命中（不实际调 LLM，token 算 0 但计数 +1） */
  recordCacheHit(): void {
    this.call_count += 1;
    // cache 命中不产生 token/cost
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
```

### 2.4 验证

```bash
npx vitest run tests/adapters/llm/_cost-tracker.test.ts
```

期望：5 个测试全通过。

---

## Task 3：`batch.ts` 接入 `completeWithCache` + CostTracker 包装

### 3.1 写测试

`tests/modules/intent-analyzer-cache.test.ts`：

```typescript
import { describe, it, expect, vi } from 'vitest';
import { analyzeBatch } from '../../src/modules/intent-analyzer/batch.js';
import { _clearMemoryCache } from '../../src/adapters/llm/_cache.js';
import type { Comment, BusinessProfile } from '../../src/core/types.js';

const mockProfile: BusinessProfile = {
  business: { name: 'Test', value_prop: 'v' },
  target_personas: [{ id: 'p1', name: 'P1', description: '', typical_pain_points: [] }],
  intent_signals: [],
  buying_stages: [],
  llm: { provider: 'deepseek', model: 'm', api_key_env: 'X' },
  crm: { type: 'feishu', config: {} },
  hook_config: { style: '', max_length: 30, language: '中文' },
};

function makeComments(n: number): Comment[] {
  return Array.from({ length: n }, (_, i) => ({
    cid: `c${i}`,
    aweme_id: 'a1',
    video_url: 'https://x',
    video_desc: 'desc',
    keyword: 'k',
    text: `comment text ${i}`,
    user: { nickname: 'u', uid: 'u', follower_count: 0, signature: '' },
    digg_count: 0, create_time: '0', reply_count: 0,
  }));
}

describe('analyzeBatch 接入 cache + cost tracker', () => {
  it('同输入二次调用,fetcher 计数只 +1（cache 命中）', async () => {
    _clearMemoryCache();
    const fetcher = vi.fn().mockResolvedValue(JSON.stringify(
      Array.from({ length: 10 }, () => ({
        is_target_persona: true, persona: 'p1', pain_point: 'x',
        intent_score: 0.8, buying_stage: 'awareness',
        suggested_reply_hook: 'a', suggested_dm_hook: 'b',
      })),
    ));

    const llm = { complete: fetcher };
    const ctx = {
      profile: mockProfile,
      systemPrompt: 'system-fixed',
      userTplStr: '{{#each comments}}{{cid}}-{{text}}\n{{/each}}',
      llm,
      threshold: 0.7,
    };

    const comments = makeComments(10);
    await analyzeBatch(comments, ctx);
    await analyzeBatch(comments, ctx);  // 第二次应命中 cache

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('不同评论列表不会命中,各调一次', async () => {
    _clearMemoryCache();
    const fetcher = vi.fn().mockResolvedValue(JSON.stringify(
      Array.from({ length: 10 }, () => ({
        is_target_persona: true, persona: 'p1', pain_point: 'x',
        intent_score: 0.8, buying_stage: 'awareness',
        suggested_reply_hook: 'a', suggested_dm_hook: 'b',
      })),
    ));
    const llm = { complete: fetcher };
    const ctx = {
      profile: mockProfile,
      systemPrompt: 'system-fixed',
      userTplStr: '{{#each comments}}{{cid}}-{{text}}\n{{/each}}',
      llm,
      threshold: 0.7,
    };

    await analyzeBatch(makeComments(10), ctx);
    await analyzeBatch(Array.from({ length: 10 }, (_, i) => makeComments(10)[0]).map(c => ({...c, cid: `c2_${i}`})), ctx);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
```

### 3.2 跑测试 —— 必须 fail

```bash
npx vitest run tests/modules/intent-analyzer-cache.test.ts
```

期望：2 个测试 fail（cache 未生效）。

### 3.3 实现

改 `src/modules/intent-analyzer/batch.ts`：

```typescript
// imports 新增
import { completeWithCache, buildCacheKey } from '../../adapters/llm/_cache.js';
import { CostTracker } from '../../adapters/llm/_cost-tracker.js';
import { getLLM as _getLLM } from '../../adapters/registry.js';

export interface BatchContext {
  profile: BusinessProfile;
  systemPrompt: string;
  userTplStr: string;
  llm: { complete(prompt: string): Promise<string> };
  threshold: number;
  hookStyle?: string;
  /** cost tracker（可选；run-daily 注入） */
  costTracker?: CostTracker;
  /** 用于 cache key 的 model 标识（默认 'unknown'） */
  modelName?: string;
}
```

改 `analyzeBatch`（替换原 `try { rawOutput = await llm.complete(...) }` 块）：

```typescript
const fullPrompt = `${systemPrompt}\n\n${userPrompt}${hookStyleHint}\n\n【输出 JSON 数组】`;
const modelName = ctx.modelName ?? 'unknown';

try {
  rawOutput = await completeWithCache({
    model: modelName,
    systemPrompt: `${systemPrompt}${hookStyleHint}`,
    userPrompt,
    fetcher: async () => {
      const r = await llm.complete(fullPrompt);
      if (ctx.costTracker) {
        ctx.costTracker.recordUsage(fullPrompt, r);
      }
      return r;
    },
    // 持久化路径后续 Phase 4 决定；MVP 不开
  });
} catch (e) { ... }
```

**关键**：cache key = sha256(model + system + user)，`fetcher` 在 cache miss 时才被调。`costTracker.recordUsage` **只在 cache miss 时**记录（命中时不调 fetcher → 不记录 cost）。✅

### 3.4 验证

```bash
npx vitest run tests/modules/intent-analyzer-cache.test.ts
```

期望：2 个测试全通过。

---

## Task 4：run-daily 注入 CostTracker + 落 cost_estimate

### 4.1 写测试

`tests/orchestration/run-daily-cost.test.ts`：

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChannelAdapter } from '../../src/core/types.js';

let tmpDir: string;
let originalCwd: string;
let historyPath: string;

const stubChannel = {
  name: 'stub',
  rateLimits: { search_per_hour: 0, user_videos_per_hour: 0, comment_per_hour: 0, friend_request_per_day: 0, dm_per_day: 0 },
  async ping() { return { ok: true, loggedIn: true }; },
  async search() { return []; },
  async getUserVideos() { return []; },
  async getVideoComments() { return []; },
} as unknown as ChannelAdapter;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'run-daily-cost-test-'));
  originalCwd = process.cwd();
  process.chdir(tmpDir);
  historyPath = join(tmpDir, 'data', 'run_history.jsonl');
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('runDaily 落 cost_estimate 到 run_history', () => {
  it('cost_estimate 字段在 entry 中存在（即使全 0）', async () => {
    // 准备 business 目录
    const businessDir = join(tmpDir, 'business');
    require('node:fs').mkdirSync(join(businessDir, 'prompts'), { recursive: true });
    require('node:fs').writeFileSync(
      join(businessDir, 'profile.yaml'),
      'business:\n  name: t\n  value_prop: v\ntarget_personas: []\nintent_signals: []\nbuying_stages: []\nllm: { provider: deepseek, model: m, api_key_env: X }\ncrm: { type: feishu, config: {} }\nhook_config: { style: s, max_length: 30, language: zh }\n',
    );
    require('node:fs').writeFileSync(join(businessDir, 'prompts', 'intent-system.md'), '# sys');
    require('node:fs').writeFileSync(join(businessDir, 'prompts', 'intent-user.md'), '{{#each comments}}{{cid}}\n{{/each}}');
    require('node:fs').writeFileSync(join(businessDir, 'channels.yaml'), 'source: { mode: sec_uid }\n');
    require('node:fs').writeFileSync(join(businessDir, 'conversion.yaml'), '');

    const { runDaily } = await import('../../src/orchestration/run-daily.js');
    await runDaily({
      businessDir,
      injectHistoryPath: historyPath,
      injectChannel: stubChannel,
      skipLLM: true,
      mode: 'read-only',
    }).catch(() => {});

    expect(existsSync(historyPath)).toBe(true);
    const content = readFileSync(historyPath, 'utf-8');
    const entry = JSON.parse(content.split('\n').filter(Boolean)[0]);
    // 关键断言
    expect(entry).toHaveProperty('cost_estimate');
    expect(entry.cost_estimate).toHaveProperty('prompt_tokens');
    expect(entry.cost_estimate).toHaveProperty('completion_tokens');
    expect(entry.cost_estimate).toHaveProperty('estimated_cost_usd');
  });
});
```

### 4.2 跑测试 —— 必须 fail

```bash
npx vitest run tests/orchestration/run-daily-cost.test.ts
```

期望：fail（entry 没有 cost_estimate 字段，或 skipLLM 路径下 fetch 不到 prompts 报错）。

### 4.3 实现

改 `src/orchestration/run-daily.ts`：

1. import `CostTracker`
2. 在 `runDaily` 函数顶部 `const costTracker = new CostTracker(opts.injectLLM ?? getLLM(...), '<name>');`
3. 把 `costTracker` 传给 batchCtx（`runDailyBody` 第 5 步 LLM 分析处）
4. `runDaily` finally 块 `appendRunHistory` entry 对象加 `cost_estimate: costTracker.snapshot()`（含 `prompt_tokens` / `completion_tokens` / `estimated_cost_usd`，**不**含 `batch_sizes` 避免污染 schema）

**注意**：
- `runDailyBody` 当前接受 `opts.injectLLM`，当 `skipLLM=true` 时**不调 LLM**——costTracker 自然累加为 0
- finally 块 entry 构造加 `cost_estimate` key（**不**改 try/catch/finally 结构）

### 4.4 验证

```bash
npx vitest run tests/orchestration/run-daily-cost.test.ts
```

期望：通过。

---

## Task 5：insights.ts 加 cost 页面

### 5.1 写测试

`tests/cli/insights-cost.test.ts`：

```typescript
import { describe, it, expect, vi } from 'vitest';
import { printCostSummary } from '../../src/cli/insights.js';
import type { RunHistoryEntry } from '../../src/orchestration/run-history.js';

function makeEntry(over: Partial<RunHistoryEntry> = {}): RunHistoryEntry {
  return {
    run_id: 'r1',
    business: 'b',
    mode: 'full',
    dry_run: false,
    started_at: '2026-06-01T00:00:00Z',
    finished_at: '2026-06-01T00:01:00Z',
    duration_ms: 60000,
    exit_reason: 'completed',
    step_durations: {},
    phase_counts: { videos_scanned: 0, comments_collected: 0, leads_created: 0, tasks_generated: 0, tasks_executed: 0 },
    errors: [],
    cost_estimate: { prompt_tokens: 1000, completion_tokens: 500, estimated_cost_usd: 0.001 },
    ...over,
  };
}

describe('printCostSummary', () => {
  it('累加 entries 的 cost_estimate 并输出', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    printCostSummary([makeEntry(), makeEntry({
      cost_estimate: { prompt_tokens: 2000, completion_tokens: 800, estimated_cost_usd: 0.002 },
    })]);
    const allOut = consoleSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(allOut).toContain('本月 LLM 成本');
    expect(allOut).toContain('0.003');  // sum
    consoleSpy.mockRestore();
  });

  it('没有 cost_estimate 的 entry 当作 0', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    printCostSummary([makeEntry({ cost_estimate: undefined })]);
    const allOut = consoleSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(allOut).toContain('本月 LLM 成本');
    consoleSpy.mockRestore();
  });
});
```

### 5.2 跑测试 —— 必须 fail

```bash
npx vitest run tests/cli/insights-cost.test.ts
```

### 5.3 实现

改 `src/cli/insights.ts`：

```typescript
// imports 新增
import { readRunHistory, type RunHistoryEntry } from '../orchestration/run-history.js';

export function printCostSummary(entries: RunHistoryEntry[]): void {
  const thisMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
  const monthEntries = entries.filter(e => e.started_at.startsWith(thisMonth));

  let prompt_tokens = 0;
  let completion_tokens = 0;
  let estimated_cost_usd = 0;
  let hasCacheData = 0;

  for (const e of monthEntries) {
    if (e.cost_estimate) {
      prompt_tokens += e.cost_estimate.prompt_tokens;
      completion_tokens += e.cost_estimate.completion_tokens;
      estimated_cost_usd += e.cost_estimate.estimated_cost_usd;
      hasCacheData++;
    }
  }

  console.log('\n[本月 LLM 成本]');
  console.log(`  Runs: ${monthEntries.length}`);
  console.log(`  Prompt tokens: ${prompt_tokens.toLocaleString()}`);
  console.log(`  Completion tokens: ${completion_tokens.toLocaleString()}`);
  console.log(`  Estimated cost: $${estimated_cost_usd.toFixed(6)} USD`);
  if (hasCacheData === 0) {
    console.log(`  ⚠️  暂无 cost 数据（升级到 Phase 2 #4 后开始累积）`);
  }
}
```

`runInsights` 末尾调用 `printCostSummary(await readRunHistory('./data/run_history.jsonl', { sinceDays: 31 }))`。

### 5.4 验证

```bash
npx vitest run tests/cli/insights-cost.test.ts
```

---

## Task 6：cache-bust 子命令

### 6.1 写测试

`tests/cli/cache-bust.test.ts`：

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('cache-bust', () => {
  it('清空 ./data/llm-cache.jsonl', async () => {
    // 准备 cache 文件
    const dir = mkdtempSync(join(tmpdir(), 'cache-bust-'));
    process.chdir(dir);
    require('node:fs').mkdirSync('./data', { recursive: true });
    writeFileSync('./data/llm-cache.jsonl', '{"x":1}\n{"x":2}\n');

    const { runCacheBust } = await import('../../src/cli/cache-bust.js');
    await runCacheBust([]);

    expect(existsSync('./data/llm-cache.jsonl')).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });
});
```

### 6.2 跑测试 —— 必须 fail

### 6.3 实现

新建 `src/cli/cache-bust.ts`：

```typescript
/**
 * cache-bust CLI 子命令
 * 用法: npx explore-star cache-bust
 * 行为: 删除 ./data/llm-cache.jsonl 整个文件（MVP 简化方案；roadmap §4 风险表）
 */

import { existsSync, unlinkSync } from 'node:fs';
import { showUsage } from './_shared.js';

const USAGE = `
用法: npx explore-star cache-bust
清空 ./data/llm-cache.jsonl 中的所有缓存条目。
`;

export async function runCacheBust(args: string[]): Promise<void> {
  if (showUsage(USAGE, args)) return;

  const cachePath = './data/llm-cache.jsonl';
  if (existsSync(cachePath)) {
    unlinkSync(cachePath);
    console.log(`[cache-bust] 已删除 ${cachePath}`);
  } else {
    console.log(`[cache-bust] ${cachePath} 不存在，无需清理`);
  }
}

export async function runCLI(args: string[]): Promise<void> {
  await runCacheBust(args);
}
```

`src/cli/index.ts` 注册新 case：

```typescript
case 'cache-bust': {
  const { runCacheBust } = await import('./cache-bust.js');
  await runCacheBust(rest);
  break;
}
```

### 6.4 验证

```bash
npx vitest run tests/cli/cache-bust.test.ts
```

---

## Task 7：跑全量测试 + smoke

### 7.1 全量测试

```bash
npx vitest run
```

期望：所有现有测试 + 新增测试全过。

### 7.2 smoke（business.example/燃点-FDE dry-run）

```bash
npx explore-star run --business ./business.example/燃点-FDE --dry-run --skip-llm --mode read-only
```

验证：
```bash
cat data/run_history.jsonl | tail -1 | python3 -c "import sys,json; e=json.loads(sys.stdin.read()); print(e.get('cost_estimate'))"
```

期望：输出 `{'prompt_tokens': 0, 'completion_tokens': 0, 'estimated_cost_usd': 0}`（skipLLM 时为 0）。

### 7.3 e2e 真实数据（验证 cache 真的省 token）

写 `tests/e2e/llm-cost-cache.test.ts`：注入 5 个相同 comment，验证 fetcher 调 1 次（不是 5 次）。

### 7.4 写 checkpoint 文档

`docs/roadmap-checkpoints/phase-2-#4-done.md`：

```markdown
# Phase 2 #4 · LLM 成本优化 · 准入门槛 checkpoint

## 实施时间
YYYY-MM-DD

## 落地内容
- [x] TTL 7 天硬过滤（src/adapters/llm/_cache.ts）
- [x] CostTracker 包装（src/adapters/llm/_cost-tracker.ts）
- [x] analyzeBatch 接入 completeWithCache（src/modules/intent-analyzer/batch.ts）
- [x] run-daily 落 cost_estimate（src/orchestration/run-daily.ts）
- [x] insights 加 cost summary 页面（src/cli/insights.ts）
- [x] cache-bust 子命令（src/cli/cache-bust.ts）

## 验证结果
- [x] vitest 全量通过（含 6 个新增测试文件）
- [x] smoke: business.example/燃点-FDE dry-run 落 cost_estimate
- [x] e2e: 5 条重复评论 → fetcher 只调 1 次

## 已知遗留
- Token 估算用字符数（1 token ≈ 4 字符），误差 ±20%；Phase 4 接 provider usage 后升级
- cache-bust 是简化版（清整个文件，不按 business 过滤）
- 缓存命中率 ≥ 15% 需要 7 天真实数据校准（spec §5）

## commit 列表
- <hash> ...
```

### 7.5 commit + push

```bash
git add -A
git commit -m "feat(cost): Phase 2 #4 LLM 成本优化（batch cache + token 埋点 + insights）"
git push -u origin feat/phase-2-llm-cost-optimization
```

---

## 任务依赖

```
Task 1 (TTL) → Task 2 (CostTracker) → Task 3 (batch 接入) → Task 4 (run-daily 落 history) → Task 5 (insights) → Task 6 (cache-bust) → Task 7 (smoke)
```

可并行：
- Task 5 独立于 Task 3/4（只读 run_history）
- Task 6 独立于其他
