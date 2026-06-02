# Phase 0 实施计划：观测与告警

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 `run-daily` 加累积可观测性（`data/run_history.jsonl`）+ 多通道 notifier 接线 + `status` CLI，让"框架跑了什么、是否挂、为什么挂"对运营**可查可告警**。

**Architecture:** 软启动 3 PR 节奏——PR 1 只写累积（不告警）→ PR 2 加 console notifier + status CLI → PR 3 多通道（email/feishu/wechat）。每步独立可测、独立可回滚。

**Tech Stack:** Node 20+ (`crypto.randomUUID`), vitest, zod, pino, 现有 `Notifier` 体系（`src/adapters/notifier/{console,email,feishu,wechat}.ts` + `src/adapters/registry.ts:96-110`）

**上游 spec：** `docs/superpowers/specs/2026-06-02-phase-0-observability-design.md`

---

## File Structure

| 文件 | 责任 | 行数估计 |
|---|---|---|
| `src/core/types.ts` (改) | `BusinessProfile` 加 `observability?` 字段 | +10 |
| `src/core/config-schemas.ts` (改) | 加 `ObservabilityConfigSchema` | +25 |
| `src/orchestration/run-history.ts` (新) | `appendRunHistory` / `readRunHistory` / `summaryStats` | ~120 |
| `src/orchestration/run-daily.ts` (改) | try/catch/finally 接线，注入点加 `injectNotifier` | +60 |
| `src/core/notifier-resolver.ts` (新) | 多通道解析 + 兜底 console | ~70 |
| `src/cli/status.ts` (新) | status CLI 子命令 | ~150 |
| `src/cli/index.ts` (改) | 注册 `status` case | +5 |
| `package.json` (改) | 加 `"status": "node dist/cli/status.js"` | +1 |
| `business.example/燃点-FDE/profile.yaml` (改) | 加 `observability` 块（默认配置）| +5 |
| `tests/orchestration/run-history.test.ts` (新) | append / read / 异常行跳过 | ~120 |
| `tests/core/notifier-resolver.test.ts` (新) | 默认 / 多通道 / 全失败兜底 | ~100 |
| `tests/orchestration/run-daily-observability.test.ts` (新) | 接线：失败告警 / login_required 告警 / 落 history | ~150 |
| `tests/cli/status.test.ts` (新) | 解析 / 输出 / 退出码 | ~120 |
| `tests/e2e/observability-wiring.test.ts` (新) | 端到端：注入失败 → 告警 + history | ~100 |

总计 ~1100 行（含测试）。

---

## PR 1 · run_history.jsonl 写入

### Task 1.1: 扩展 BusinessProfile 加 `observability` 字段

**Files:**
- Modify: `src/core/types.ts`（在 `feedback_config?` 后插入 `observability?`）
- Modify: `src/core/config-schemas.ts`（在 `feedback_config` schema 后插入 `observability` schema）
- Modify: `business.example/燃点-FDE/profile.yaml`（在 `feedback_config` 后加 `observability` 块）
- Modify: `tests/core/config-schemas.test.ts`（加 3 个测试 case）

- [ ] **Step 1: 写失败的 schema 测试**

在 `tests/core/config-schemas.test.ts` 末尾 `describe('businessProfileSchema', ...)` 块内加：

```typescript
it('accepts observability with default values', () => {
  const r = businessProfileSchema.safeParse({
    ...VALID_PROFILE,
    observability: { run_history: { enabled: true }, notifier: { enabled: true, channels: ['console'] } },
  });
  expect(r.success).toBe(true);
});

it('rejects observability.run_history.enabled !== boolean', () => {
  const r = businessProfileSchema.safeParse({
    ...VALID_PROFILE,
    observability: { run_history: { enabled: 'yes' as any } },
  });
  expect(r.success).toBe(false);
});

it('rejects observability.notifier.channels with non-string entries', () => {
  const r = businessProfileSchema.safeParse({
    ...VALID_PROFILE,
    observability: { notifier: { channels: [123 as any] } },
  });
  expect(r.success).toBe(false);
});
```

- [ ] **Step 2: 跑测试，预期失败**

```bash
npm test -- tests/core/config-schemas.test.ts
```

Expected: 3 个新测试 FAIL（"Invalid input" / 字段未定义）

- [ ] **Step 3: 改 `src/core/types.ts`**

在 `BusinessProfile` 接口 `feedback_config?` 之后（约第 54 行后）插入：

```typescript
  observability?: {
    run_history?: { enabled?: boolean };          // 默认 true
    notifier?: {
      enabled?: boolean;                          // 默认 true
      channels?: string[];                        // 默认 ['console']
    };
  };
```

- [ ] **Step 4: 改 `src/core/config-schemas.ts`**

在 `feedback_config` schema 之后（约第 117 行 `}).passthrough().optional(),` 后）插入：

```typescript
  observability: z.object({
    run_history: z.object({
      enabled: z.boolean().optional(),
    }).passthrough().optional(),
    notifier: z.object({
      enabled: z.boolean().optional(),
      channels: z.array(NonEmptyString).optional(),
    }).passthrough().optional(),
  }).passthrough().optional(),
```

- [ ] **Step 5: 改 `business.example/燃点-FDE/profile.yaml`**

在 `feedback_config:` 块之后追加：

```yaml
  observability:
    run_history:
      enabled: true
    notifier:
      enabled: true
      channels: ['console']
```

- [ ] **Step 6: 跑测试，预期通过**

```bash
npm test -- tests/core/config-schemas.test.ts
```

Expected: 全部通过（包括新加的 3 个）

- [ ] **Step 7: 跑完整测试套，确认无 regression**

```bash
npm test
```

Expected: 现有测试全通过

- [ ] **Step 8: commit**

```bash
git add src/core/types.ts src/core/config-schemas.ts business.example/燃点-FDE/profile.yaml tests/core/config-schemas.test.ts
git commit -m "feat(observability): BusinessProfile 加 observability 字段

- types.ts: 加 observability? 嵌套（run_history.enabled + notifier.{enabled, channels}）
- config-schemas.ts: 加对应 Zod schema（passthrough，可扩展）
- business.example/燃点-FDE/profile.yaml: 默认配置（run_history on, notifier on, channels=['console']）
- tests: 3 个新 case（默认值 / 类型校验 / 数组元素类型校验）"
```

---

### Task 1.2: `run-history.ts` 模块 —— `appendRunHistory`

**Files:**
- Create: `src/orchestration/run-history.ts`
- Create: `tests/orchestration/run-history.test.ts`

- [ ] **Step 1: 写测试文件头**

`tests/orchestration/run-history.test.ts`：

```typescript
/**
 * src/orchestration/run-history.ts 单元测试
 *
 * 覆盖：
 *   - appendRunHistory: 原子写（tmp + rename）+ append
 *   - readRunHistory: 过滤坏行（log warn 跳过）+ 按时间倒序 + sinceDays 过滤
 *   - summaryStats: run 数 / 失败数 / 错误聚合 top 5
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  appendRunHistory,
  readRunHistory,
  summaryStats,
  type RunHistoryEntry,
} from '../../src/orchestration/run-history.js';

let tmpDir: string;
let historyPath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'run-history-test-'));
  historyPath = join(tmpDir, 'run_history.jsonl');
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function makeEntry(overrides: Partial<RunHistoryEntry> = {}): RunHistoryEntry {
  return {
    run_id: crypto.randomUUID(),
    business: '/test/business',
    mode: 'full',
    dry_run: false,
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
    duration_ms: 1000,
    exit_reason: 'completed',
    step_durations: {},
    phase_counts: { videos_scanned: 0, comments_collected: 0, leads_created: 0, tasks_generated: 0, tasks_executed: 0 },
    errors: [],
    ...overrides,
  };
}
```

- [ ] **Step 2: 写 `appendRunHistory` 的失败测试**

在 `describe` 块内加：

```typescript
describe('appendRunHistory', () => {
  it('appends an entry to a new file', async () => {
    await appendRunHistory(historyPath, makeEntry());
    const content = readFileSync(historyPath, 'utf-8');
    const lines = content.split('\n').filter(l => l.length > 0);
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.exit_reason).toBe('completed');
  });

  it('appends to existing file (multiple entries)', async () => {
    await appendRunHistory(historyPath, makeEntry({ exit_reason: 'completed' }));
    await appendRunHistory(historyPath, makeEntry({ exit_reason: 'failed' }));
    const content = readFileSync(historyPath, 'utf-8');
    const lines = content.split('\n').filter(l => l.length > 0);
    expect(lines).toHaveLength(2);
  });

  it('uses atomic write (tmp + rename) — no .tmp file remains after success', async () => {
    await appendRunHistory(historyPath, makeEntry());
    const tmpFile = `${historyPath}.tmp.${process.pid}`;
    expect(existsSync(tmpFile)).toBe(false);
  });

  it('creates parent dir if missing', async () => {
    const nestedPath = join(tmpDir, 'nested', 'subdir', 'history.jsonl');
    await appendRunHistory(nestedPath, makeEntry());
    expect(existsSync(nestedPath)).toBe(true);
  });
});
```

- [ ] **Step 3: 跑测试，预期失败**

```bash
npm test -- tests/orchestration/run-history.test.ts
```

Expected: FAIL（模块未找到 / 函数未定义）

- [ ] **Step 4: 实现 `src/orchestration/run-history.ts`（第一版）**

```typescript
/**
 * 累积 run 历史（data/run_history.jsonl）
 *
 * V1.4 + Phase 0：append-only JSONL，每行一条 RunHistoryEntry
 *
 * 设计：
 *   - 原子写：写 tmp 文件后 rename 替换整个文件（不是 append）
 *     原因：JSONL append 在断电时可能损坏末尾行；rename 是 POSIX 原子操作
 *   - 文件 < 1MB 时 O(N) 重写可接受；Phase 0 不优化
 *   - 坏行：readRunHistory 跳过（log warn），不阻塞后续
 */

import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { logger } from '../core/logger.js';

const log = logger.child({ module: 'run-history' });

export interface RunHistoryEntry {
  run_id: string;
  business: string;
  mode: 'full' | 'read-only';
  dry_run: boolean;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  exit_reason: 'completed' | 'failed' | 'login_required' | 'browser_escalated' | 'cancelled';
  step_durations: Record<string, number>;
  phase_counts: {
    videos_scanned: number;
    comments_collected: number;
    leads_created: number;
    tasks_generated: number;
    tasks_executed: number;
  };
  errors: string[];
  cost_estimate?: {
    prompt_tokens: number;
    completion_tokens: number;
    estimated_cost_usd: number;
  };
}

export async function appendRunHistory(
  filePath: string,
  entry: RunHistoryEntry,
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });

  // 读现有内容（如果存在）
  let existing = '';
  if (existsSync(filePath)) {
    try {
      existing = await readFile(filePath, 'utf-8');
    } catch {
      existing = '';  // 读失败 → 当作空文件处理
    }
  }

  // 拼接新行（确保以 \n 分隔）
  const newLine = JSON.stringify(entry);
  const newContent = existing.length === 0 || existing.endsWith('\n')
    ? existing + newLine + '\n'
    : existing + '\n' + newLine + '\n';

  // 原子写
  const tmp = `${filePath}.tmp.${process.pid}`;
  await writeFile(tmp, newContent, 'utf-8');
  await rename(tmp, filePath);
}
```

- [ ] **Step 5: 跑测试，预期通过**

```bash
npm test -- tests/orchestration/run-history.test.ts
```

Expected: 4 个 `appendRunHistory` 测试通过

- [ ] **Step 6: commit**

```bash
git add src/orchestration/run-history.ts tests/orchestration/run-history.test.ts
git commit -m "feat(observability): run-history 模块 — appendRunHistory（原子写）"
```

---

### Task 1.3: `run-history.ts` —— `readRunHistory` + `summaryStats`

**Files:**
- Modify: `src/orchestration/run-history.ts`
- Modify: `tests/orchestration/run-history.test.ts`

- [ ] **Step 1: 写 `readRunHistory` 的失败测试**

在 `tests/orchestration/run-history.test.ts` 加：

```typescript
describe('readRunHistory', () => {
  it('returns empty array if file does not exist', async () => {
    const result = await readRunHistory(historyPath);
    expect(result).toEqual([]);
  });

  it('parses all entries from file', async () => {
    await appendRunHistory(historyPath, makeEntry({ exit_reason: 'completed' }));
    await appendRunHistory(historyPath, makeEntry({ exit_reason: 'failed' }));
    const result = await readRunHistory(historyPath);
    expect(result).toHaveLength(2);
  });

  it('skips corrupted lines (logs warn, does not throw)', async () => {
    writeFileSync(historyPath, [
      JSON.stringify(makeEntry()),
      '{ this is not valid JSON',
      JSON.stringify(makeEntry({ exit_reason: 'failed' })),
      '',
    ].join('\n'), 'utf-8');

    const result = await readRunHistory(historyPath);
    expect(result).toHaveLength(2);
    expect(result[0].exit_reason).toBe('completed');
    expect(result[1].exit_reason).toBe('failed');
  });

  it('filters by sinceDays', async () => {
    const now = Date.now();
    const oldEntry = makeEntry({
      started_at: new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString(),  // 10 天前
    });
    const newEntry = makeEntry({
      started_at: new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString(),   // 1 天前
    });
    await appendRunHistory(historyPath, oldEntry);
    await appendRunHistory(historyPath, newEntry);

    const result = await readRunHistory(historyPath, { sinceDays: 7 });
    expect(result).toHaveLength(1);
    expect(result[0].run_id).toBe(newEntry.run_id);
  });
});

describe('summaryStats', () => {
  it('returns zero counts for empty input', () => {
    const stats = summaryStats([]);
    expect(stats.totalRuns).toBe(0);
    expect(stats.failedRuns).toBe(0);
    expect(stats.avgDurationMs).toBe(0);
  });

  it('computes totalRuns / failedRuns / avgDurationMs', () => {
    const entries = [
      makeEntry({ duration_ms: 100, exit_reason: 'completed' }),
      makeEntry({ duration_ms: 200, exit_reason: 'failed' }),
      makeEntry({ duration_ms: 300, exit_reason: 'completed' }),
    ];
    const stats = summaryStats(entries);
    expect(stats.totalRuns).toBe(3);
    expect(stats.failedRuns).toBe(1);
    expect(stats.avgDurationMs).toBe(200);
  });

  it('aggregates top 5 errors by normalized message', () => {
    const entries = [
      makeEntry({ errors: ['LLM timeout', 'rate_limited'] }),
      makeEntry({ errors: ['LLM timeout'] }),
      makeEntry({ errors: ['rate_limited'] }),
      makeEntry({ errors: ['rate_limited'] }),
      makeEntry({ errors: ['rate_limited'] }),
      makeEntry({ errors: ['unique error'] }),
    ];
    const stats = summaryStats(entries);
    expect(stats.topErrors[0].message).toBe('rate_limited');
    expect(stats.topErrors[0].count).toBe(4);
    expect(stats.topErrors[1].message).toBe('LLM timeout');
    expect(stats.topErrors[1].count).toBe(2);
  });
});
```

- [ ] **Step 2: 跑测试，预期失败**

```bash
npm test -- tests/orchestration/run-history.test.ts
```

Expected: FAIL（`readRunHistory` / `summaryStats` 未定义）

- [ ] **Step 3: 在 `run-history.ts` 追加 `readRunHistory` 和 `summaryStats`**

在 `appendRunHistory` 函数后追加：

```typescript
export interface ReadRunHistoryOptions {
  sinceDays?: number;  // 默认 30
}

export async function readRunHistory(
  filePath: string,
  options: ReadRunHistoryOptions = {},
): Promise<RunHistoryEntry[]> {
  if (!existsSync(filePath)) return [];

  let raw: string;
  try {
    raw = await readFile(filePath, 'utf-8');
  } catch (e) {
    log.warn({ filePath, err: e }, '读取 run_history 失败，返回空数组');
    return [];
  }

  const sinceDays = options.sinceDays ?? 30;
  const cutoffMs = sinceDays > 0 ? Date.now() - sinceDays * 24 * 60 * 60 * 1000 : 0;

  const entries: RunHistoryEntry[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as RunHistoryEntry;
      if (cutoffMs > 0 && new Date(entry.started_at).getTime() < cutoffMs) continue;
      entries.push(entry);
    } catch (e) {
      log.warn({ filePath, line: line.slice(0, 100), err: e }, '跳过损坏的 run_history 行');
    }
  }

  return entries;
}

export interface RunHistoryStats {
  totalRuns: number;
  failedRuns: number;
  avgDurationMs: number;
  topErrors: Array<{ message: string; count: number }>;
}

export function summaryStats(entries: RunHistoryEntry[]): RunHistoryStats {
  if (entries.length === 0) {
    return { totalRuns: 0, failedRuns: 0, avgDurationMs: 0, topErrors: [] };
  }

  const failedRuns = entries.filter(e => e.exit_reason !== 'completed').length;
  const totalDuration = entries.reduce((sum, e) => sum + e.duration_ms, 0);
  const avgDurationMs = Math.round(totalDuration / entries.length);

  // 错误聚合（按消息原样 dedup，Phase 0 不做归一化）
  const errorCounts = new Map<string, number>();
  for (const e of entries) {
    for (const errMsg of e.errors) {
      errorCounts.set(errMsg, (errorCounts.get(errMsg) ?? 0) + 1);
    }
  }
  const topErrors = [...errorCounts.entries()]
    .map(([message, count]) => ({ message, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return { totalRuns: entries.length, failedRuns, avgDurationMs, topErrors };
}
```

- [ ] **Step 4: 跑测试，预期通过**

```bash
npm test -- tests/orchestration/run-history.test.ts
```

Expected: 全部 12 个测试通过（4 append + 4 read + 3 summaryStats + 1 existing test header）

- [ ] **Step 5: commit**

```bash
git add src/orchestration/run-history.ts tests/orchestration/run-history.test.ts
git commit -m "feat(observability): run-history 加 readRunHistory + summaryStats

- readRunHistory: 坏行 log warn 跳过；sinceDays 过滤（默认 30）
- summaryStats: total / failed / avgDuration / top 5 errors
- 配套测试 7 个"
```

---

### Task 1.4: 接线 `run-daily.ts` —— 写 `run_history`（**不**接 notifier）

**Files:**
- Modify: `src/orchestration/run-daily.ts`
- Create: `tests/orchestration/run-daily-observability.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/orchestration/run-daily-observability.test.ts`：

```typescript
/**
 * run-daily.ts 观测性接线测试
 *
 * Phase 0 PR 1：验证 run_history 在成功路径必落盘（finally 块语义）
 * Phase 0 PR 2（Task 2.2）：失败路径 + notifier 告警
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChannelAdapter } from '../../src/core/types.js';

let tmpDir: string;
let originalCwd: string;
let historyPath: string;

const stubChannel: ChannelAdapter = {
  name: 'stub',
  // ... stub 所有 ChannelAdapter 方法返回空数组
  // 关键：loginSession 不抛（避开 LoginRequiredError 路径，专注 finally 块）
} as unknown as ChannelAdapter;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'run-daily-obs-test-'));
  originalCwd = process.cwd();
  process.chdir(tmpDir);
  historyPath = join(tmpDir, 'data', 'run_history.jsonl');
});

afterEach(() => {
  process.chwd(originalCwd);
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('runDaily writes run_history on success path (finally 块语义)', () => {
  it('appends exactly one entry per run, even if business fails mid-pipeline', async () => {
    const { runDaily } = await import('../../src/orchestration/run-daily.js');

    // 业务目录不存在 → loadBusinessProfile 抛 → runDaily 走 catch → finally 落 history
    await runDaily({
      businessDir: '/nonexistent-for-test',
      injectHistoryPath: historyPath,
      injectWriteHistory: true,
      skipLLM: true,
      mode: 'read-only',
    }).catch(() => { /* 预期 throw */ });

    // finally 块保证 history 必落
    expect(existsSync(historyPath)).toBe(true);
    const content = readFileSync(historyPath, 'utf-8');
    const lines = content.split('\n').filter(l => l.length > 0);
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]);
    expect(entry.business).toBe('/nonexistent-for-test');
    expect(entry.mode).toBe('read-only');
    expect(entry.exit_reason).toBe('failed');  // 业务失败 → exit_reason='failed'
  });
});
```

- [ ] **Step 2: 跑测试，预期失败（编译错误或 module not found）**

```bash
npm test -- tests/orchestration/run-daily-observability.test.ts
```

Expected: FAIL（可能因为导入路径错误或测试 setup 问题）

- [ ] **Step 3: 改 `src/orchestration/run-daily.ts`**

在文件顶部 import 后（约第 19 行 `const log = ...` 后）插入：

```typescript
import { appendRunHistory, type RunHistoryEntry } from './run-history.js';
```

在 `RunDailyOptions` 接口加（保留 inject 模式）：

```typescript
  /** 测试注入：自定义 run_history 路径（默认 data/run_history.jsonl） */
  injectHistoryPath?: string;
  /** 测试注入：是否写 history（默认 true；测试可关） */
  injectWriteHistory?: boolean;
```

修改 `runDaily` 主函数（保留 `LoginRequiredError` catch 路径，**仅**加 finally + history 写入，**不**改 notifier 行为）：

```typescript
export async function runDaily(opts: RunDailyOptions): Promise<RunDailyResult> {
  const t0 = Date.now();
  const date = new Date().toISOString().slice(0, 10);
  const errors: string[] = [];

  log.info({ business: opts.businessDir, date, mode: opts.mode ?? 'full' }, '启动');

  // 检查是否新的一天，如果是则重置状态
  const state = await loadState();
  if (state.date !== date) {
    await resetForNewDay();
  }

  const historyPath = opts.injectHistoryPath ?? './data/run_history.jsonl';
  const writeHistory = opts.injectWriteHistory !== false;
  const startedAt = new Date().toISOString();
  const runId = crypto.randomUUID();
  let exitReason: RunHistoryEntry['exit_reason'] = 'failed';
  const stepDurations: Record<string, number> = {};
  const phaseCounts: RunHistoryEntry['phase_counts'] = {
    videos_scanned: 0, comments_collected: 0, leads_created: 0, tasks_generated: 0, tasks_executed: 0,
  };

  try {
    const result = await runDailyBody(opts, t0, date, errors, stepDurations, phaseCounts);
    exitReason = errors.length === 0 ? 'completed' : 'failed';
    return result;
  } catch (e) {
    if (e instanceof LoginRequiredError) {
      exitReason = 'login_required';
      await handleLoginRequired(opts.businessDir);
      // 重新构造一个 result 抛出前的状态（保留 errors 数组）
    } else {
      exitReason = 'failed';
    }
    throw e;
  } finally {
    if (writeHistory) {
      try {
        await appendRunHistory(historyPath, {
          run_id: runId,
          business: opts.businessDir,
          mode: opts.mode ?? 'full',
          dry_run: !!opts.dryRun,
          started_at: startedAt,
          finished_at: new Date().toISOString(),
          duration_ms: Date.now() - t0,
          exit_reason: exitReason,
          step_durations: stepDurations,
          phase_counts: phaseCounts,
          errors,
        });
      } catch (historyErr) {
        log.error({ err: historyErr, runId }, '写 run_history 失败（不阻塞主流程）');
      }
    }
  }
}
```

> **注意：** `runDailyBody` 的签名需要从 `(opts, t0, date, errors)` 扩展为 `(opts, t0, date, errors, stepDurations, phaseCounts)`。这需要在 `runDailyBody` 函数定义处加参数。

- [ ] **Step 4: 改 `runDailyBody` 函数签名 + body 内填值**

找到 `runDailyBody` 函数定义（约第 118 行），加 2 个参数：

```typescript
async function runDailyBody(
  opts: RunDailyOptions,
  t0: number,
  date: string,
  errors: string[],
  stepDurations: Record<string, number>,
  phaseCounts: RunHistoryEntry['phase_counts'],
): Promise<RunDailyResult> {
```

**在 body 内部集成（对每个 step）**：

`runDailyBody` 已有 7 个 step（reconnaissance/analysis/sync/task_generation/execution/notification/health_check），每个 step 都有自己的 try/catch。**对每个 step 入口加 `stepStart`，出口加 `stepDurations[stepName]`**。模式：

```typescript
// 现有结构（伪代码示意，按实际 step 名称对齐）
const stepStart_recon = Date.now();
try {
  // ... 现有 reconnaissance 逻辑
  stepDurations['reconnaissance'] = Date.now() - stepStart_recon;
} catch (e) {
  stepDurations['reconnaissance'] = Date.now() - stepStart_recon;
  throw e;
}
```

**在 `runDailyBody` 收尾（return result 前）填 `phaseCounts`**：

```typescript
phaseCounts.videos_scanned = result.videosScanned;
phaseCounts.comments_collected = result.commentsCollected;
phaseCounts.leads_created = result.leadsCreated;
phaseCounts.tasks_generated = result.tasksGenerated;
phaseCounts.tasks_executed = result.tasksExecuted;
```

> **实施提示：** 现有 `runDailyBody` 大约 400 行。**不要重构** step 内部逻辑，**只**在每个 step 入口记 `stepStart`、出口写 `stepDurations[stepName]`、收尾填 `phaseCounts`。`run-daily.ts:44-52` 已有 `STEP_NAMES` 常量，**用它的 name 字符串**对齐 `stepDurations` 的 key。

- [ ] **Step 5: 跑测试，预期通过**

```bash
npm test -- tests/orchestration/run-daily-observability.test.ts
npm test  # 完整跑确认无 regression
```

Expected: PR 1 测试通过；现有 `tests/orchestration/run-daily.test.ts` **可能**因 `runDailyBody` 签名变化而需要小幅调整（如果有直接调用 `runDailyBody` 的测试）。

- [ ] **Step 6: commit**

```bash
git add src/orchestration/run-daily.ts tests/orchestration/run-daily-observability.test.ts
git commit -m "feat(observability): run-daily 接线 run_history 写入

- runDaily() 加 try/catch/finally，finally 写 run_history
- 新增 injectHistoryPath / injectWriteHistory 测试钩子
- runDailyBody 签名加 stepDurations + phaseCounts 输出参数
- runDailyBody 内部每个 step 入口/出口加计时；收尾填 phaseCounts
- 历史 catch 路径（LoginRequiredError）也写 history，exit_reason='login_required'"
```

**PR 1 准入门槛：**
- `data/run_history.jsonl` 在 `business.example/燃点-FDE` 上能累积（跑 3 次 `--skip-llm --dry-run` 即可）
- 现有 `run-daily.test.ts` 不修改通过

---

## PR 2 · console notifier + status CLI

### Task 2.1: `notifier-resolver.ts` 模块

**Files:**
- Create: `src/core/notifier-resolver.ts`
- Create: `tests/core/notifier-resolver.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/core/notifier-resolver.test.ts`：

```typescript
/**
 * src/core/notifier-resolver.ts 单元测试
 *
 * 覆盖：
 *   - 默认 channels = ['console']
 *   - profile.yaml 没 observability.notifier 时用默认
 *   - profile.yaml 配 channels: ['feishu'] 时只解析 feishu
 *   - 配置的 channel 没注册 → log warn 跳过，**不**抛
 *   - 全部 channel 失败 → 兜底 console
 *   - 全空 channels 数组 → 抛错（明示用户配错）
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { BusinessProfile, Notifier } from '../../src/core/types.js';

const mockRegistry: Record<string, Notifier> = {};

vi.mock('../../src/adapters/registry.js', () => ({
  getNotifier: (name: string) => {
    const n = mockRegistry[name];
    if (!n) throw new Error(`Notifier "${name}" 未注册`);
    return n;
  },
}));

import { resolveNotifiers } from '../../src/core/notifier-resolver.js';

function makeNotifier(name: string): Notifier {
  return { name, send: vi.fn().mockResolvedValue({ ok: true }) };
}

function makeProfile(overrides: Partial<BusinessProfile['observability']> = {}): BusinessProfile {
  return {
    business: { name: 'test', value_prop: 'x' },
    target_personas: [{ id: 'p1', name: 'P1', typical_pain_points: ['x'] }],
    intent_signals: ['x'],
    llm: { provider: 'deepseek', model: 'd', api_key_env: 'X' },
    crm: { type: 'csv', config: {} },
    observability: overrides as any,
  };
}

beforeEach(() => {
  for (const k of Object.keys(mockRegistry)) delete mockRegistry[k];
  mockRegistry.console = makeNotifier('console');
  mockRegistry.feishu = makeNotifier('feishu');
});

describe('resolveNotifiers', () => {
  it('defaults to [console] when observability is undefined', () => {
    const result = resolveNotifiers(makeProfile(undefined));
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('console');
  });

  it('defaults to [console] when notifier.channels is undefined', () => {
    const result = resolveNotifiers(makeProfile({ notifier: { enabled: true } }));
    expect(result.map(n => n.name)).toEqual(['console']);
  });

  it('respects configured channels', () => {
    const result = resolveNotifiers(makeProfile({ notifier: { channels: ['console', 'feishu'] } }));
    expect(result.map(n => n.name)).toEqual(['console', 'feishu']);
  });

  it('skips unregistered channel with warn (does not throw)', () => {
    const result = resolveNotifiers(makeProfile({ notifier: { channels: ['nonexistent', 'console'] } }));
    expect(result.map(n => n.name)).toEqual(['console']);
  });

  it('falls back to [console] when ALL configured channels fail', () => {
    const result = resolveNotifiers(makeProfile({ notifier: { channels: ['nonexistent'] } }));
    expect(result.map(n => n.name)).toEqual(['console']);
  });

  it('throws when channels is empty array (explicit user error)', () => {
    expect(() => resolveNotifiers(makeProfile({ notifier: { channels: [] } }))).toThrow(/至少配置 1 个/);
  });

  it('returns [] when notifier.enabled is false', () => {
    const result = resolveNotifiers(makeProfile({ notifier: { enabled: false, channels: ['console'] } }));
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑测试，预期失败**

```bash
npm test -- tests/core/notifier-resolver.test.ts
```

Expected: FAIL（模块未找到）

- [ ] **Step 3: 实现 `src/core/notifier-resolver.ts`**

```typescript
/**
 * Notifier 多通道解析
 *
 * 设计：
 *   - 从 profile.yaml observability.notifier.channels 读通道列表
 *   - 默认 ['console']（兜底，绝不静默丢告警）
 *   - 未注册的 channel log warn 跳过；全失败 → 兜底 console
 *   - channels=[] 视为用户配错，抛错（明示而不是默默用 console）
 */

import type { BusinessProfile, Notifier } from './types.js';
import { getNotifier } from '../adapters/registry.js';
import { logger } from './logger.js';

const log = logger.child({ module: 'notifier-resolver' });

const DEFAULT_CHANNELS = ['console'];

export function resolveNotifiers(profile: BusinessProfile): Notifier[] {
  const notifierCfg = profile.observability?.notifier;
  if (notifierCfg?.enabled === false) return [];

  let channels: string[];
  if (notifierCfg?.channels === undefined) {
    channels = DEFAULT_CHANNELS;
  } else {
    if (notifierCfg.channels.length === 0) {
      throw new Error('observability.notifier.channels 至少配置 1 个通道（留空 = 显式 disable，请用 enabled: false）');
    }
    channels = notifierCfg.channels;
  }

  const resolved: Notifier[] = [];
  for (const name of channels) {
    try {
      resolved.push(getNotifier(name));
    } catch (e) {
      log.warn({ channel: name, err: e instanceof Error ? e.message : String(e) }, 'notifier 通道未注册或解析失败，跳过');
    }
  }

  // 全失败 → 兜底 console（但 channels 显式传了非空数组时不要兜底，让用户感知）
  if (resolved.length === 0) {
    if (notifierCfg?.channels !== undefined) {
      log.error({ channels }, '所有配置的 notifier 通道均失败，未发送任何告警');
      return [];
    }
    // 默认 channels（用户没配）兜底
    try {
      resolved.push(getNotifier('console'));
    } catch (e) {
      log.error({ err: e }, '兜底 console notifier 也无法注册，告警完全无法送达');
    }
  }

  return resolved;
}
```

- [ ] **Step 4: 跑测试，预期通过**

```bash
npm test -- tests/core/notifier-resolver.test.ts
```

Expected: 7 个测试全过

- [ ] **Step 5: commit**

```bash
git add src/core/notifier-resolver.ts tests/core/notifier-resolver.test.ts
git commit -m "feat(observability): notifier-resolver 模块（多通道 + console 兜底）"
```

---

### Task 2.2: 接线 `run-daily.ts` —— 失败时发 notifier 告警

**Files:**
- Modify: `src/orchestration/run-daily.ts`
- Modify: `tests/orchestration/run-daily-observability.test.ts`

- [ ] **Step 1: 加 notifier 注入点 + 失败告警测试**

在 `tests/orchestration/run-daily-observability.test.ts` 加：

```typescript
import type { Notifier } from '../../src/core/types.js';

function makeTestNotifier(): Notifier & { send: ReturnType<typeof vi.fn> } {
  return {
    name: 'test',
    send: vi.fn().mockResolvedValue({ ok: true, message_id: 'test-1' }),
  };
}

describe('runDaily fires notifier on failure', () => {
  it('sends critical alert on LoginRequiredError', async () => {
    // 注：需要 mock LoginRequiredError 抛出路径
    // 简化版：手动构造 notifier mock + 触发 catch 路径
    const testNotifier = makeTestNotifier();
    const { runDaily, LoginRequiredError } = await import('../../src/orchestration/run-daily.js');

    // 注入一个抛 LoginRequiredError 的 channel
    const errorChannel: any = {
      loginSession: vi.fn().mockRejectedValue(new LoginRequiredError('test')),
      // ... 其他 ChannelAdapter 方法 stub
    };

    // 触发 runDaily 走完到 LoginRequiredError catch
    try {
      await runDaily({
        businessDir: '/test',
        injectChannel: errorChannel,
        injectNotifiers: [testNotifier],
        skipLLM: true,
        mode: 'read-only',
      });
    } catch {
      // 预期 throw
    }

    expect(testNotifier.send).toHaveBeenCalled();
    const message = testNotifier.send.mock.calls[0][0];
    expect(message.level).toBe('critical');
    expect(message.body).toMatch(/login/i);
  });
});
```

- [ ] **Step 2: 跑测试，预期失败（`injectNotifiers` 未定义 / LoginRequiredError 未导出）**

```bash
npm test -- tests/orchestration/run-daily-observability.test.ts
```

Expected: FAIL

- [ ] **Step 3: 改 `src/orchestration/run-daily.ts`**

在 `RunDailyOptions` 加注入点：

```typescript
  /** 测试注入：覆盖 notifier 列表（默认从 observability 配置读） */
  injectNotifiers?: Notifier[];
  /** 测试注入：覆盖 notifier 解析函数 */
  injectResolveNotifiers?: (profile: BusinessProfile) => Notifier[];
```

在 import 区加：

```typescript
import type { Notifier, BusinessProfile } from '../core/types.js';
import { resolveNotifiers as defaultResolveNotifiers } from '../core/notifier-resolver.js';
import { loadBusinessProfile } from '../core/business-profile.js';  // 确认已存在
```

修改 `runDaily` 主函数：把 `handleLoginRequired` 改造为发送 notifier 告警：

```typescript
} catch (e) {
  if (e instanceof LoginRequiredError) {
    exitReason = 'login_required';
    // 立即通知（不等 finally）
    const notifiers = opts.injectNotifiers ?? await loadAndResolveNotifiers(opts);
    for (const n of notifiers) {
      await sendWithTimeout(n, {
        title: '探星：需要登录抖音',
        body: `业务 ${opts.businessDir} 的 run 在 ${new Date().toISOString()} 触发 LoginRequiredError。\n请检查 opencli / Chrome 登录态。`,
        level: 'critical',
      });
    }
    await handleLoginRequired(opts.businessDir);
  } else {
    exitReason = 'failed';
  }
  throw e;
} finally {
  // ... 同 PR 1
  // 失败路径（非 login_required）也发告警
  if (writeHistory && exitReason !== 'completed') {
    const notifiers = opts.injectNotifiers ?? await loadAndResolveNotifiers(opts);
    for (const n of notifiers) {
      await sendWithTimeout(n, {
        title: `探星：run 失败 (${exitReason})`,
        body: `业务 ${opts.businessDir} 在 ${new Date().toISOString()} run 失败，exit_reason=${exitReason}，错误数=${errors.length}。\n首条错误：${errors[0] ?? '(无)'}`,
        level: exitReason === 'login_required' ? 'critical' : 'warning',
      });
    }
  }
}
```

在文件末尾加 helper：

```typescript
async function loadAndResolveNotifiers(opts: RunDailyOptions): Promise<Notifier[]> {
  try {
    const loaded = await loadBusinessProfile(opts.businessDir);
    return (opts.injectResolveNotifiers ?? defaultResolveNotifiers)(loaded.profile);
  } catch (e) {
    log.warn({ err: e }, '加载 profile 失败，告警跳过');
    return [];
  }
}

async function sendWithTimeout(n: Notifier, message: Parameters<Notifier['send']>[0]): Promise<void> {
  try {
    await Promise.race([
      n.send(message),
      new Promise((_, reject) => setTimeout(() => reject(new Error('notifier.send timeout')), 10_000)),
    ]);
  } catch (e) {
    log.error({ notifier: n.name, err: e instanceof Error ? e.message : String(e) }, 'notifier.send 失败/超时');
    // 绝不抛出 — finally 块不能因为 notifier 失败而 throw
  }
}
```

导出 `LoginRequiredError`（如果未导出，加 `export class LoginRequiredError`）。

- [ ] **Step 4: 跑测试，预期通过**

```bash
npm test -- tests/orchestration/run-daily-observability.test.ts
npm test
```

Expected: 全部通过

- [ ] **Step 5: commit**

```bash
git add src/orchestration/run-daily.ts tests/orchestration/run-daily-observability.test.ts
git commit -m "feat(observability): run-daily 失败时发 notifier 告警

- LoginRequiredError catch 立即发 critical 告警
- finally 块失败路径发 warning 告警
- notifier.send 10s 超时（Promise.race）+ 兜底 log error
- 新增 injectNotifiers / injectResolveNotifiers 测试钩子"
```

**PR 2 准入门槛：**
- 注入 1 次故意失败 → console 收到 1 条告警 + run_history 落 entry
- 注入 1 次 `LoginRequiredError` → console 立即收到 critical 告警

---

### Task 2.3: `status` CLI 子命令

**Files:**
- Create: `src/cli/status.ts`
- Create: `tests/cli/status.test.ts`

- [ ] **Step 1: 写测试**

`tests/cli/status.test.ts`：

```typescript
/**
 * src/cli/status.ts 单元测试
 *
 * 覆盖：
 *   - human 格式输出（7 天 run 数 / 失败率 / 平均耗时 / 错误 top 5）
 *   - json 格式输出
 *   - 0 run 时显示警告 + 退出码 1
 *   - 全部 run completed 时退出码 0
 *   - 有 failed run 时退出码 1
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatStatusHuman, formatStatusJson, decideExitCode } from '../../src/cli/status.js';
import { appendRunHistory, makeEntry } from '../orchestration/run-history.test-helper.js';

let tmpDir: string;
let historyPath: string;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'status-test-'));
  historyPath = join(tmpDir, 'run_history.jsonl');
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('formatStatusHuman', () => {
  it('includes run count and failure rate', async () => {
    await appendRunHistory(historyPath, makeEntry({ exit_reason: 'completed' }));
    await appendRunHistory(historyPath, makeEntry({ exit_reason: 'failed' }));
    const output = formatStatusHuman({ business: 'test', days: 7, entries: await import('../../src/orchestration/run-history.js').then(m => m.readRunHistory(historyPath)) });
    expect(output).toMatch(/Run 总数/);
    expect(output).toMatch(/失败数/);
    expect(output).toMatch(/2/);  // 2 runs
    expect(output).toMatch(/50\.0%/);  // 50% failure
  });
});

describe('formatStatusJson', () => {
  it('produces valid JSON with structured fields', async () => {
    await appendRunHistory(historyPath, makeEntry({ exit_reason: 'completed' }));
    const output = formatStatusJson({ business: 'test', days: 7, entries: await import('../../src/orchestration/run-history.js').then(m => m.readRunHistory(historyPath)) });
    const parsed = JSON.parse(output);
    expect(parsed.business).toBe('test');
    expect(parsed.days).toBe(7);
    expect(parsed.stats.totalRuns).toBe(1);
  });
});

describe('decideExitCode', () => {
  it('returns 0 when all runs are completed', () => {
    const entries = [makeEntry({ exit_reason: 'completed' })];
    expect(decideExitCode(entries, false)).toBe(0);
  });

  it('returns 1 when any run is failed', () => {
    const entries = [makeEntry({ exit_reason: 'completed' }), makeEntry({ exit_reason: 'failed' })];
    expect(decideExitCode(entries, false)).toBe(1);
  });

  it('returns 1 when no runs and neverRunBefore is false (停跑)', () => {
    expect(decideExitCode([], false)).toBe(1);
  });

  it('returns 0 when no runs and neverRunBefore is true (从未跑过，不算异常)', () => {
    expect(decideExitCode([], true)).toBe(0);
  });
});
```

> **注：** 这个测试用了 `run-history.test-helper.js` 假设。我们改为直接 import 共享 fixture。

- [ ] **Step 2: 改测试 —— 共享 fixture**

把 `tests/orchestration/run-history.test.ts` 顶部的 `makeEntry` 抽到 `tests/_helpers/run-history-fixture.ts`（新建），两个测试文件都 import。

- [ ] **Step 3: 跑测试，预期失败**

```bash
npm test -- tests/cli/status.test.ts
```

Expected: FAIL

- [ ] **Step 4: 实现 `src/cli/status.ts`**

```typescript
/**
 * CLI 子命令：status
 *
 * 用法: npx explore-star status --business <dir> [--days 7] [--json]
 *       扫 data/run_history.jsonl，输出最近 N 天的 health 概览
 *
 * 退出码：
 *   0   全部 run 都是 completed
 *   1   最近一次 run 是 failed/login_required/browser_escalated
 *        OR 历史有过 run 但最近 7 天无（"停跑"信号）
 */

import { readFileSync } from 'node:fs';
import { extractFlag, showUsage, selfInvoke } from './_shared.js';
import { readRunHistory, summaryStats, type RunHistoryEntry } from '../orchestration/run-history.js';
import { logger } from '../core/logger.js';

const log = logger.child({ module: 'cli/status' });

const USAGE = `
用法:
  npx explore-star status --business <dir>
  npx explore-star status --business <dir> --days 30
  npx explore-star status --business <dir> --json

选项:
  --business <dir>    业务目录（必填）
  --days <n>          查看最近 N 天（默认 7）
  --json              输出结构化 JSON
`.trim();

const HISTORY_PATH = './data/run_history.jsonl';

export interface StatusOptions {
  business: string;
  days: number;
  entries: RunHistoryEntry[];
}

export function formatStatusHuman(opts: StatusOptions): string {
  const stats = summaryStats(opts.entries);
  const failureRate = stats.totalRuns === 0 ? 0 : (stats.failedRuns / stats.totalRuns) * 100;
  const recent5 = opts.entries
    .slice()
    .sort((a, b) => b.started_at.localeCompare(a.started_at))
    .slice(0, 5);

  let out = `📊 探星健康概览 · ${opts.business} · 最近 ${opts.days} 天\n\n`;
  out += `✅ Run 总数：${stats.totalRuns}\n`;
  out += `❌ 失败数：${stats.failedRuns} (${failureRate.toFixed(1)}%)\n`;
  out += `⏱  平均耗时：${(stats.avgDurationMs / 1000).toFixed(1)}s\n\n`;

  if (stats.topErrors.length > 0) {
    out += `🔥 Top 错误：\n`;
    for (const e of stats.topErrors) {
      out += `  [${e.count}x] ${e.message}\n`;
    }
    out += `\n`;
  }

  if (recent5.length > 0) {
    out += `最近 ${Math.min(5, recent5.length)} 次 run：\n`;
    for (const r of recent5) {
      const date = r.started_at.slice(0, 16).replace('T', ' ');
      const icon = r.exit_reason === 'completed' ? '✅' : '❌';
      out += `  ${date}  ${icon} ${r.exit_reason.padEnd(20)} ${(r.duration_ms / 1000).toFixed(1)}s\n`;
    }
  } else {
    out += `⚠️  最近 ${opts.days} 天无 run。\n`;
  }

  return out;
}

export function formatStatusJson(opts: StatusOptions): string {
  const stats = summaryStats(opts.entries);
  return JSON.stringify({
    business: opts.business,
    days: opts.days,
    stats,
    entries: opts.entries.slice(-5),  // 最近 5 条
  }, null, 2);
}

export function decideExitCode(entries: RunHistoryEntry[], neverRunBefore: boolean): number {
  if (entries.length === 0) {
    return neverRunBefore ? 0 : 1;  // 从未跑过 = 0；跑了但停了 = 1
  }
  // 最近一次 run（按 started_at 倒序第一个）
  const lastEntry = entries.slice().sort((a, b) => b.started_at.localeCompare(a.started_at))[0];
  return lastEntry.exit_reason === 'completed' ? 0 : 1;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    readFileSync(path);
    return true;
  } catch {
    return false;
  }
}

export async function runStatus(args: string[]): Promise<void> {
  if (showUsage(USAGE, args)) return;

  const business = extractFlag(args, '--business');
  if (!business) {
    console.log(USAGE);
    console.error('\n错误：status 需要 --business <dir>');
    process.exit(1);
  }
  const daysRaw = extractFlag(args, '--days');
  const days = daysRaw ? Math.max(1, parseInt(daysRaw, 10)) : 7;
  const jsonMode = args.includes('--json');

  // neverRunBefore 判定：history 文件不存在
  const neverRunBefore = !(await fileExists(HISTORY_PATH));
  const entries = neverRunBefore ? [] : await readRunHistory(HISTORY_PATH, { sinceDays: days });

  const opts: StatusOptions = { business, days, entries };

  if (jsonMode) {
    console.log(formatStatusJson(opts));
  } else {
    console.log(formatStatusHuman(opts));
  }

  const exitCode = decideExitCode(entries, neverRunBefore);
  if (exitCode !== 0) {
    log.warn({ exitCode, business }, 'status 检测到异常，退出码非 0');
    process.exit(exitCode);
  }
}

export async function runCLI(args: string[]): Promise<void> {
  await runStatus(args);
}

selfInvoke(runCLI);
```

- [ ] **Step 5: 跑测试，预期通过**

```bash
npm test -- tests/cli/status.test.ts
```

- [ ] **Step 6: commit**

```bash
git add src/cli/status.ts tests/cli/status.test.ts tests/_helpers/run-history-fixture.ts
git commit -m "feat(observability): status CLI 子命令

- human 格式 + json 格式
- decideExitCode: 区分'从未跑过'vs'停跑'
- 退出码 0/1 让 cron 能感知"
```

---

### Task 2.4: 注册 `status` 命令到 `cli/index.ts`

**Files:**
- Modify: `src/cli/index.ts`
- Modify: `package.json`

- [ ] **Step 1: 改 `src/cli/index.ts`**

在 switch 中 `case 'retry-dlq':` 后插入：

```typescript
      case 'status': {
        const { runCLI } = await import('./status.js');
        await runCLI(rest);
        break;
      }
```

在顶部 USAGE 块加：

```
  status                  查看 run 健康概览（--business 必填，--days / --json 可选）
```

- [ ] **Step 2: 改 `package.json`**

在 `scripts` 块加：

```json
    "status": "node dist/cli/status.js"
```

- [ ] **Step 3: 编译 + 跑 CLI 验证**

```bash
npm run build
node dist/cli/status.js --business ./business.example/燃点-FDE
```

Expected: 输出 human 格式（"0 run" 或已有的几条），退出码 0 或 1

- [ ] **Step 4: commit**

```bash
git add src/cli/index.ts package.json
git commit -m "feat(observability): 注册 status CLI 命令 + npm script"
```

**PR 2 准入门槛：**
- `node dist/cli/status.js --business ./business.example/燃点-FDE` 输出 human 格式
- `--json` 模式输出 valid JSON
- 注入失败后 status 显示 failed entry

---

## PR 3 · 多通道 notifier（可选 / 软启动）

> **决策：PR 3 仅在 PR 1-2 跑稳后才做。** 本节作为 outline，具体任务等 PR 1-2 验证后再展开。

### Task 3.1: 读 `notifier.yaml` 配置

**Files:**
- Create: `src/core/notifier-config.ts`（约 50 行：解析 `business/notifier.yaml`）
- Modify: `src/core/notifier-resolver.ts`（`resolveNotifiers` 签名加可选 `notifierYamlPath`）

### Task 3.2: 多通道并发发送 + 失败聚合

**Files:**
- Modify: `src/core/notifier-resolver.ts`（加 `sendToAll` helper，Promise.allSettled）

### Task 3.3: e2e 验证 email/feishu/wechat 真实发送

**Files:**
- Create: `tests/e2e/multi-channel-notifier.test.ts`（需要 mock SMTP / webhook 端点）

---

## Final · Phase 0 done verification

### Task 4.0: 跑 7 条 done checklist 验证

- [ ] 在 `business.example/燃点-FDE` 上跑 3 次 `node dist/orchestration/run-daily.js --business ./business.example/燃点-FDE --skip-llm --dry-run` → 验证 `data/run_history.jsonl` 累积 3 条
- [ ] 跑 `node dist/cli/status.js --business ./business.example/燃点-FDE` → 输出 human 格式
- [ ] 注入 1 次故意 LLM 失败（修改 profile.yaml 用错的 API key 跑 1 次）→ console 收到 warning 告警 + history 落 failed entry
- [ ] 注入 1 次 LoginRequiredError（mock channel.loginSession throw）→ console 收到 critical 告警
- [ ] `notifier-resolver` 在所有通道配置缺失时返回 console notifier
- [ ] `npm test` 全部通过
- [ ] 现有 4 个 notifier 实现（console/email/feishu/wechat）的 unit test 不修改通过

### Task 4.1: 写 Phase 0 准入门槛 checkpoint doc

**Files:**
- Create: `docs/roadmap-checkpoints/phase-0-done.md`

内容：7 条 done checklist 的验证结果（每条贴实际输出/截图），签字栏给老板 review。

- [ ] 写完 commit：

```bash
git add docs/roadmap-checkpoints/phase-0-done.md
git commit -m "docs: Phase 0 准入门槛验证报告"
```

### Task 4.2: merge `feat/phase-0-observability` 到 main

- [ ] 跑完整 `npm test` 一次
- [ ] `git checkout main && git merge feat/phase-0-observability --no-ff -m "Merge Phase 0: 观测与告警"`
- [ ] **不**删分支（保留做参考；如要删 `git branch -d feat/phase-0-observability`）

---

## 变更记录

- V0.1：初版。从 `docs/superpowers/specs/2026-06-02-phase-0-observability-design.md` V0.1 展开为 TDD 实施计划。共 11 个 task（含 PR 3 outline）。
