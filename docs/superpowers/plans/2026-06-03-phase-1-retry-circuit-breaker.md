# Phase 1 Implementation Plan: 分级重试与熔断

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement 3-tier retry (comment / lead / step) + per-channel rate limiter + hand-written circuit breaker + structured error contract upgrade. All without third-party libs.

**Architecture:** Three new core modules (`rate-limiter.ts`, `circuit-breaker.ts`, `crm-sync/error-classifier.ts`) plug into existing `run-daily.ts` orchestration. Profile.yaml grows `retry_config`. `RunDailyResult.errors` becomes structured `{phase, severity, error, count}[]` with backward-compat read for legacy `string[]` entries.

**Tech Stack:** TypeScript ESM / Node ≥ 20 / vitest / zod / pino / handlebars (no new deps)

**Branch:** `feat/phase-1-retry-circuit-breaker` (already created from main)

---

## File Structure

| Path | Action | Lines (est) | Responsibility |
|---|---|---|---|
| `src/core/rate-limiter.ts` | NEW | ~110 | Per-channel QPS + daily quota; throws `RateLimitHaltedError` when QPS=0 |
| `src/core/circuit-breaker.ts` | NEW | ~85 | 3-state machine CLOSED/OPEN/HALF_OPEN with `exec()` wrapper |
| `src/modules/crm-sync/error-classifier.ts` | NEW | ~65 | 4-class classification of CRM errors via regex |
| `src/orchestration/run-daily.ts` | MODIFY | +60 / -20 | Plug 3-tier retry + upgrade errors to structured + step 5 wrap |
| `src/orchestration/run-history.ts` | MODIFY | +30 / -10 | Union schema for `errors`; read-time normalization |
| `src/modules/intent-analyzer/batch.ts` | MODIFY | +25 / -5 | On full-batch failure, append to `data/dlq/intent-failures.jsonl` |
| `src/modules/crm-sync/dlq.ts` | MODIFY | +40 / -15 | Use classifier to decide retry vs archive+alert |
| `src/modules/task-executor/index.ts` | MODIFY | +50 / -10 | Wrap `executeTasks` with browser-restart-1x-then-escalate + circuit breaker |
| `src/core/config-schemas.ts` | MODIFY | +50 / 0 | `RetryConfigSchema` + `StructuredErrorSchema` + `channelRateLimitsSchema` |
| `src/core/business-profile.ts` | MODIFY | +15 / 0 | Load + zod-parse `channel_rate_limits` from `channels.yaml` |
| `tests/core/rate-limiter.test.ts` | NEW | ~150 | 6+ cases incl. QPS=0 escalation |
| `tests/core/circuit-breaker.test.ts` | NEW | ~120 | 5+ cases for state machine |
| `tests/modules/crm-sync/error-classifier.test.ts` | NEW | ~80 | 4-class + edge cases |
| `tests/orchestration/run-daily-retry.test.ts` | NEW | ~200 | 5% LLM fail / browser disconnect / QPS=0 |
| `tests/orchestration/run-history-compat.test.ts` | NEW | ~80 | Legacy `string[]` read still works |
| `tests/modules/intent-analyzer/batch-dlq.test.ts` | NEW | ~90 | Failure batch → DLQ file |
| `tests/modules/crm-sync/dlq-classify.test.ts` | MODIFY | +50 | `rate_limited` retry 1x; `auth_failed` no retry; `unknown` 3x |
| `tests/e2e/phase-1-retry-wiring.test.ts` | NEW | ~150 | E2E wiring across run-daily → DLQ → notifier |
| `business.example/燃点-FDE/profile.yaml` | MODIFY | +12 / 0 | Add `retry_config` example |
| `business.example/燃点-FDE/channels.yaml` | MODIFY | +8 / 0 | Add `channel_rate_limits` example |
| `docs/roadmap-checkpoints/phase-1-done.md` | NEW | ~120 | 8-line done checklist + commit list |

---

## Task 1: Circuit Breaker (foundation, no dependencies)

**Files:**
- Create: `src/core/circuit-breaker.ts`
- Test: `tests/core/circuit-breaker.test.ts`

- [ ] **Step 1.1: Write failing tests**

Write `tests/core/circuit-breaker.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { CircuitBreaker, CircuitOpenError } from '../../../src/core/circuit-breaker.js';

describe('CircuitBreaker', () => {
  it('starts CLOSED and lets calls through', async () => {
    const cb = new CircuitBreaker({ name: 'test', failureThreshold: 3, cooldownMs: 1000 });
    expect(cb.getState()).toBe('CLOSED');
    const result = await cb.exec(async () => 'ok');
    expect(result).toBe('ok');
  });

  it('opens after threshold failures and throws CircuitOpenError', async () => {
    const onOpen = vi.fn();
    const cb = new CircuitBreaker({ name: 'test', failureThreshold: 2, cooldownMs: 1000, onOpen });
    const fail = async () => { throw new Error('boom'); };
    await expect(cb.exec(fail)).rejects.toThrow('boom');
    await expect(cb.exec(fail)).rejects.toThrow('boom');
    expect(cb.getState()).toBe('OPEN');
    expect(onOpen).toHaveBeenCalledWith('OPEN');
    // OPEN → throws CircuitOpenError without invoking fn
    const calls = vi.fn(fail);
    await expect(cb.exec(calls)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(calls).not.toHaveBeenCalled();
  });

  it('transitions OPEN → HALF_OPEN after cooldown', async () => {
    let now = 1000;
    const cb = new CircuitBreaker({
      name: 'test', failureThreshold: 1, cooldownMs: 500,
      injectClock: () => now,
    });
    await expect(cb.exec(async () => { throw new Error('x'); })).rejects.toThrow('x');
    expect(cb.getState()).toBe('OPEN');
    now += 600;  // advance past cooldown
    expect(cb.getState()).toBe('HALF_OPEN');
    const result = await cb.exec(async () => 'recovered');
    expect(result).toBe('recovered');
    expect(cb.getState()).toBe('CLOSED');
  });

  it('HALF_OPEN failure re-opens the circuit', async () => {
    let now = 1000;
    const cb = new CircuitBreaker({
      name: 'test', failureThreshold: 1, cooldownMs: 500,
      injectClock: () => now,
    });
    await expect(cb.exec(async () => { throw new Error('x'); })).rejects.toThrow('x');
    now += 600;
    expect(cb.getState()).toBe('HALF_OPEN');
    await expect(cb.exec(async () => { throw new Error('still broken'); })).rejects.toThrow('still broken');
    expect(cb.getState()).toBe('OPEN');
  });

  it('recordSuccess resets failure count in CLOSED state', async () => {
    const cb = new CircuitBreaker({ name: 'test', failureThreshold: 3, cooldownMs: 1000 });
    cb.recordFailure();
    cb.recordFailure();
    cb.recordSuccess();
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe('CLOSED');  // 3rd failure still under threshold
  });
});
```

- [ ] **Step 1.2: Run tests to verify they fail**

Run: `npx vitest run tests/core/circuit-breaker.test.ts`
Expected: FAIL with "Cannot find module ../../../src/core/circuit-breaker.js"

- [ ] **Step 1.3: Write minimal implementation**

Write `src/core/circuit-breaker.ts`:

```ts
/**
 * 3 状态熔断器（手写，无第三方依赖）
 *
 * 状态机：
 *   CLOSED ──(failures >= threshold)──→ OPEN
 *   OPEN   ──(now - opened_at >= cooldown)──→ HALF_OPEN
 *   HALF_OPEN ──(success)──→ CLOSED
 *   HALF_OPEN ──(failure)──→ OPEN
 *
 * 状态仅存内存（**不**持久化）—— 重启进程 = 状态清零，对齐 fail-loud
 */

import { logger } from './logger.js';

const log = logger.child({ module: 'circuit-breaker' });

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export class CircuitOpenError extends Error {
  readonly code = 'CIRCUIT_OPEN' as const;
  constructor(public breakerName: string) {
    super(`Circuit breaker "${breakerName}" is OPEN`);
    this.name = 'CircuitOpenError';
  }
}

export interface CircuitBreakerOptions {
  name: string;
  failureThreshold: number;
  cooldownMs: number;
  halfOpenMaxAttempts?: number;
  onOpen?: (state: CircuitState) => void;
  injectClock?: () => number;
}

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private openedAt?: number;
  private readonly clock: () => number;
  private readonly halfOpenMax: number;

  constructor(private readonly opts: CircuitBreakerOptions) {
    this.clock = opts.injectClock ?? Date.now;
    this.halfOpenMax = opts.halfOpenMaxAttempts ?? 1;
  }

  getState(): CircuitState {
    this.maybeTransitionToHalfOpen();
    return this.state;
  }

  async exec<T>(fn: () => Promise<T>): Promise<T> {
    this.maybeTransitionToHalfOpen();
    if (this.state === 'OPEN') {
      throw new CircuitOpenError(this.opts.name);
    }
    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (e) {
      this.recordFailure();
      throw e;
    }
  }

  recordSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      this.transitionTo('CLOSED');
    }
    this.failureCount = 0;
  }

  recordFailure(): void {
    this.failureCount++;
    if (this.state === 'HALF_OPEN') {
      this.transitionTo('OPEN');
      return;
    }
    if (this.failureCount >= this.opts.failureThreshold) {
      this.transitionTo('OPEN');
    }
  }

  private maybeTransitionToHalfOpen(): void {
    if (this.state === 'OPEN' && this.openedAt !== undefined) {
      if (this.clock() - this.openedAt >= this.opts.cooldownMs) {
        this.transitionTo('HALF_OPEN');
      }
    }
  }

  private transitionTo(next: CircuitState): void {
    if (this.state === next) return;
    const prev = this.state;
    this.state = next;
    if (next === 'OPEN') {
      this.openedAt = this.clock();
    } else if (next === 'CLOSED') {
      this.failureCount = 0;
      this.openedAt = undefined;
    }
    log.info({ name: this.opts.name, from: prev, to: next }, 'circuit breaker state change');
    if (next === 'OPEN' && this.opts.onOpen) {
      try { this.opts.onOpen(next); } catch (e) {
        log.error({ err: e }, 'onOpen hook threw (ignored)');
      }
    }
  }
}
```

- [ ] **Step 1.4: Run tests to verify they pass**

Run: `npx vitest run tests/core/circuit-breaker.test.ts`
Expected: 5/5 PASS

- [ ] **Step 1.5: Commit**

```bash
git add src/core/circuit-breaker.ts tests/core/circuit-breaker.test.ts
git commit -m "feat(retry): 3-state circuit breaker (CLOSED/OPEN/HALF_OPEN) + 5 unit tests"
```

---

## Task 2: CRM Error Classifier

**Files:**
- Create: `src/modules/crm-sync/error-classifier.ts`
- Test: `tests/modules/crm-sync/error-classifier.test.ts`

- [ ] **Step 2.1: Write failing tests**

Write `tests/modules/crm-sync/error-classifier.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { classifyCrmError } from '../../../src/modules/crm-sync/error-classifier.js';

describe('classifyCrmError', () => {
  it('detects rate_limited (英文)', () => {
    expect(classifyCrmError('rate limit exceeded')).toBe('rate_limited');
    expect(classifyCrmError('HTTP 429 too many requests')).toBe('rate_limited');
    expect(classifyCrmError('throttled by API')).toBe('rate_limited');
  });

  it('detects rate_limited (中文)', () => {
    expect(classifyCrmError('请求被限流')).toBe('rate_limited');
    expect(classifyCrmError('触发限流策略')).toBe('rate_limited');
  });

  it('detects auth_failed (401/403/中文)', () => {
    expect(classifyCrmError('401 unauthorized')).toBe('auth_failed');
    expect(classifyCrmError('403 forbidden, invalid token')).toBe('auth_failed');
    expect(classifyCrmError('token expired')).toBe('auth_failed');
    expect(classifyCrmError('凭证已过期')).toBe('auth_failed');
  });

  it('detects schema_invalid (400/422/中文)', () => {
    expect(classifyCrmError('400 bad request, missing field')).toBe('schema_invalid');
    expect(classifyCrmError('422 unprocessable entity, invalid schema')).toBe('schema_invalid');
    expect(classifyCrmError('字段缺失: name')).toBe('schema_invalid');
    expect(classifyCrmError('schema validation failed')).toBe('schema_invalid');
  });

  it('returns unknown for unclassified errors', () => {
    expect(classifyCrmError(new Error('connection reset'))).toBe('unknown');
    expect(classifyCrmError('something completely different')).toBe('unknown');
  });

  it('accepts Error objects (not just strings)', () => {
    expect(classifyCrmError(new Error('429 too many requests'))).toBe('rate_limited');
  });

  it('case-insensitive matching', () => {
    expect(classifyCrmError('RATE LIMIT')).toBe('rate_limited');
    expect(classifyCrmError('Auth Token Expired')).toBe('auth_failed');
  });
});
```

- [ ] **Step 2.2: Run tests to verify they fail**

Run: `npx vitest run tests/modules/crm-sync/error-classifier.test.ts`
Expected: FAIL with module not found

- [ ] **Step 2.3: Write minimal implementation**

Write `src/modules/crm-sync/error-classifier.ts`:

```ts
/**
 * CRM 错误分类（4 类）
 *
 * 设计：
 *   - 基于错误消息文本匹配，**不**做 schema parse（避免信息损失）
 *   - regex 大小写不敏感，同时匹配中英文
 *   - 永远返回一个 category（**不**抛错），便于失败路径不会引入二级 throw
 *
 * 类别与触发模式：
 *   rate_limited:    /rate.?limit|429|too.?many.?requests|throttle|限流/i
 *   auth_failed:     /auth|401|403|token|credential|expired|凭证/i
 *   schema_invalid:  /schema|field|required|missing|invalid|422|400|字段/i
 *   unknown:         其他
 */

export type CrmErrorCategory = 'rate_limited' | 'auth_failed' | 'schema_invalid' | 'unknown';

const PATTERNS: Record<Exclude<CrmErrorCategory, 'unknown'>, RegExp> = {
  rate_limited: /rate.?limit|429|too.?many.?requests|throttle|限流/i,
  auth_failed: /auth|401|403|token|credential|expired|凭证/i,
  schema_invalid: /schema|field|required|missing|invalid|422|400|字段/i,
};

export function classifyCrmError(err: Error | string): CrmErrorCategory {
  const msg = err instanceof Error ? err.message : String(err);
  for (const [category, pattern] of Object.entries(PATTERNS) as Array<[Exclude<CrmErrorCategory, 'unknown'>, RegExp]>) {
    if (pattern.test(msg)) return category;
  }
  return 'unknown';
}
```

- [ ] **Step 2.4: Run tests to verify they pass**

Run: `npx vitest run tests/modules/crm-sync/error-classifier.test.ts`
Expected: 7/7 PASS

- [ ] **Step 2.5: Commit**

```bash
git add src/modules/crm-sync/error-classifier.ts tests/modules/crm-sync/error-classifier.test.ts
git commit -m "feat(retry): CRM 4 类错误分类（rate_limited/auth_failed/schema_invalid/unknown）"
```

---

## Task 3: Rate Limiter (per-channel QPS + daily quota)

**Files:**
- Create: `src/core/rate-limiter.ts`
- Test: `tests/core/rate-limiter.test.ts`

- [ ] **Step 3.1: Write failing tests**

Write `tests/core/rate-limiter.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RateLimiter, RateLimitHaltedError } from '../../../src/core/rate-limiter.js';
import type { Notifier, NotificationMessage, SendResult } from '../../../src/core/types.js';

class SpyNotifier implements Notifier {
  readonly name = 'spy';
  messages: NotificationMessage[] = [];
  async send(message: NotificationMessage): Promise<SendResult> {
    this.messages.push(message);
    return { ok: true };
  }
}

const noopSleep = () => Promise.resolve();

describe('RateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('passes when QPS > 0 and recent call was long enough ago', async () => {
    const notifier = new SpyNotifier();
    const rl = RateLimiter.fromConfig({
      channelLimits: { search_qps: 2, user_videos_qps: 1, comment_qps: 5, friend_request_per_day: 10, dm_per_day: 20 },
      adapterLimits: { search_per_hour: 100, user_videos_per_hour: 100, comment_per_hour: 100, friend_request_per_day: 10, dm_per_day: 20 },
      notifier,
      sleep: noopSleep,
    });
    await expect(rl.waitForSearch()).resolves.toBeUndefined();
    expect(notifier.messages).toHaveLength(0);
  });

  it('throws RateLimitHaltedError when search_qps=0 AND sends exactly 1 critical notifier', async () => {
    const notifier = new SpyNotifier();
    const rl = RateLimiter.fromConfig({
      channelLimits: { search_qps: 0, user_videos_qps: 1, comment_qps: 1, friend_request_per_day: 10, dm_per_day: 20 },
      adapterLimits: { search_per_hour: 100, user_videos_per_hour: 100, comment_per_hour: 100, friend_request_per_day: 10, dm_per_day: 20 },
      notifier,
      sleep: noopSleep,
    });
    await expect(rl.waitForSearch()).rejects.toBeInstanceOf(RateLimitHaltedError);
    await expect(rl.waitForSearch()).rejects.toBeInstanceOf(RateLimitHaltedError);
    expect(notifier.messages).toHaveLength(1);
    expect(notifier.messages[0].level).toBe('critical');
    expect(notifier.messages[0].title).toMatch(/停服|halt/i);
  });

  it('daily quota: canFriendRequest returns false when quota reached', async () => {
    const notifier = new SpyNotifier();
    const rl = RateLimiter.fromConfig({
      channelLimits: { search_qps: 1, user_videos_qps: 1, comment_qps: 1, friend_request_per_day: 2, dm_per_day: 5 },
      adapterLimits: { search_per_hour: 100, user_videos_per_hour: 100, comment_per_hour: 100, friend_request_per_day: 2, dm_per_day: 5 },
      notifier,
      sleep: noopSleep,
    });
    expect(rl.canFriendRequest()).toBe(true);
    rl.recordFriendRequest();
    expect(rl.canFriendRequest()).toBe(true);
    rl.recordFriendRequest();
    expect(rl.canFriendRequest()).toBe(false);
  });

  it('daily quota: recordDm increments; canDm respects quota', async () => {
    const notifier = new SpyNotifier();
    const rl = RateLimiter.fromConfig({
      channelLimits: { search_qps: 1, user_videos_qps: 1, comment_qps: 1, friend_request_per_day: 5, dm_per_day: 1 },
      adapterLimits: { search_per_hour: 100, user_videos_per_hour: 100, comment_per_hour: 100, friend_request_per_day: 5, dm_per_day: 1 },
      notifier,
      sleep: noopSleep,
    });
    rl.recordDm();
    expect(rl.canDm()).toBe(false);
  });

  it('QPS throttle: second call within interval sleeps; release after', async () => {
    const notifier = new SpyNotifier();
    const sleep = vi.fn(() => Promise.resolve());
    const rl = RateLimiter.fromConfig({
      channelLimits: { search_qps: 2, user_videos_qps: 1, comment_qps: 1, friend_request_per_day: 5, dm_per_day: 5 },
      adapterLimits: { search_per_hour: 100, user_videos_per_hour: 100, comment_per_hour: 100, friend_request_per_day: 5, dm_per_day: 5 },
      notifier,
      sleep,
    });
    await rl.waitForSearch();
    const p = rl.waitForSearch();
    expect(sleep).toHaveBeenCalled();
    await p;
  });

  it('does NOT escalate when QPS > 0 (only on QPS=0)', async () => {
    const notifier = new SpyNotifier();
    const rl = RateLimiter.fromConfig({
      channelLimits: { search_qps: 0.5, user_videos_qps: 0.5, comment_qps: 0.5, friend_request_per_day: 5, dm_per_day: 5 },
      adapterLimits: { search_per_hour: 100, user_videos_per_hour: 100, comment_per_hour: 100, friend_request_per_day: 5, dm_per_day: 5 },
      notifier,
      sleep: noopSleep,
    });
    await rl.waitForSearch();
    expect(notifier.messages).toHaveLength(0);
  });
});
```

- [ ] **Step 3.2: Run tests to verify they fail**

Run: `npx vitest run tests/core/rate-limiter.test.ts`
Expected: FAIL with module not found

- [ ] **Step 3.3: Write minimal implementation**

Write `src/core/rate-limiter.ts`:

```ts
/**
 * Per-channel 速率限制调度器
 *
 * 设计：
 *   - QPS 用 token bucket 简化版（不引 p-queue）
 *   - QPS=0 边界：构造时立即调 escalateIfHalted() 发**一次** notifier
 *     后续每次 wait 调用直接 throw RateLimitHaltedError
 *   - fail-loud：QPS=0 = 停服 + escalate，**不**静默空跑
 *   - 每日计数（friend_request / dm）走内存（不持久化，进程崩 = 计数清零）
 *     理由：本期是节奏控制，不是预算控制；Phase 0 已有 task-executor 的磁盘版
 */

import { logger } from './logger.js';
import type { Notifier, RateLimits } from './types.js';

const log = logger.child({ module: 'rate-limiter' });

export class RateLimitHaltedError extends Error {
  readonly code = 'RATE_LIMIT_HALTED' as const;
  constructor(public resource: string) {
    super(`Rate limit halted: ${resource} qps=0 (escalated, no more calls allowed)`);
    this.name = 'RateLimitHaltedError';
  }
}

export interface ChannelRateLimitsConfig {
  search_qps: number;
  user_videos_qps: number;
  comment_qps: number;
  friend_request_per_day: number;
  dm_per_day: number;
}

export interface RateLimiterOptions {
  channelLimits: ChannelRateLimitsConfig;
  adapterLimits: RateLimits;
  notifier?: Notifier;
  sleep?: (ms: number) => Promise<void>;
}

type QpsResource = 'search' | 'user_videos' | 'comment';

export class RateLimiter {
  private lastCallMs: Record<QpsResource, number> = { search: 0, user_videos: 0, comment: 0 };
  private haltedResources = new Set<QpsResource>();
  private friendRequestToday = 0;
  private dmToday = 0;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly notifier?: Notifier;
  private readonly channelLimits: ChannelRateLimitsConfig;
  private readonly adapterLimits: RateLimits;

  private constructor(opts: RateLimiterOptions) {
    this.channelLimits = opts.channelLimits;
    this.adapterLimits = opts.adapterLimits;
    this.notifier = opts.notifier;
    this.sleep = opts.sleep ?? defaultSleep;
  }

  static fromConfig(opts: RateLimiterOptions): RateLimiter {
    const rl = new RateLimiter(opts);
    // 启动时检查 QPS=0 → 立即 escalate（**只**一次 per resource）
    for (const [resource, qps] of [
      ['search', opts.channelLimits.search_qps],
      ['user_videos', opts.channelLimits.user_videos_qps],
      ['comment', opts.channelLimits.comment_qps],
    ] as Array<[QpsResource, number]>) {
      if (qps === 0 && !rl.haltedResources.has(resource)) {
        rl.haltedResources.add(resource);
        log.error({ resource }, 'QPS=0 — 渠道停服');
        if (rl.notifier) {
          void rl.notifier.send({
            title: `[探星] 渠道停服 · ${resource} QPS=0`,
            body: `${resource} qps 配置为 0，run 终止。请检查 channels.yaml channel_rate_limits。`,
            level: 'critical',
          });
        }
      }
    }
    return rl;
  }

  async waitForSearch(): Promise<void> { return this.waitWithQps('search', this.channelLimits.search_qps); }
  async waitForUserVideos(): Promise<void> { return this.waitWithQps('user_videos', this.channelLimits.user_videos_qps); }
  async waitForComment(): Promise<void> { return this.waitWithQps('comment', this.channelLimits.comment_qps); }

  canFriendRequest(): boolean {
    return this.friendRequestToday < Math.min(this.channelLimits.friend_request_per_day, this.adapterLimits.friend_request_per_day);
  }
  canDm(): boolean {
    return this.dmToday < Math.min(this.channelLimits.dm_per_day, this.adapterLimits.dm_per_day);
  }
  recordFriendRequest(): void { this.friendRequestToday++; }
  recordDm(): void { this.dmToday++; }

  private async waitWithQps(resource: QpsResource, qps: number): Promise<void> {
    if (this.haltedResources.has(resource)) {
      throw new RateLimitHaltedError(resource);
    }
    if (qps === 0) {
      this.haltedResources.add(resource);
      throw new RateLimitHaltedError(resource);
    }
    const minIntervalMs = 1000 / qps;
    const elapsed = Date.now() - this.lastCallMs[resource];
    if (elapsed < minIntervalMs) {
      await this.sleep(minIntervalMs - elapsed);
    }
    this.lastCallMs[resource] = Date.now();
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

- [ ] **Step 3.4: Run tests to verify they pass**

Run: `npx vitest run tests/core/rate-limiter.test.ts`
Expected: 6/6 PASS

- [ ] **Step 3.5: Commit**

```bash
git add src/core/rate-limiter.ts tests/core/rate-limiter.test.ts
git commit -m "feat(retry): per-channel rate limiter (QPS + daily quota + QPS=0 停服)"
```

---

## Task 4: Structured error schema + config schemas

**Files:**
- Modify: `src/core/config-schemas.ts` (add `RetryConfigSchema`, `StructuredErrorSchema`, `ChannelRateLimitsSchema`)
- Test: `tests/core/config-schemas.test.ts` (append new cases)

- [ ] **Step 4.1: Read existing config-schemas.test.ts to understand test style**

Read: `tests/core/config-schemas.test.ts` (first 50 lines to understand fixture style)

- [ ] **Step 4.2: Write failing test for new schemas**

Append to `tests/core/config-schemas.test.ts`:

```ts
import { RetryConfigSchema, StructuredErrorSchema, ChannelRateLimitsSchema } from '../../src/core/config-schemas.js';

describe('RetryConfigSchema', () => {
  it('accepts empty (all optional)', () => {
    expect(RetryConfigSchema.safeParse({}).success).toBe(true);
  });

  it('accepts full config', () => {
    const r = RetryConfigSchema.safeParse({
      comment_level: { enabled: true, max_attempts: 2 },
      lead_level: { enabled: true, max_attempts: 3, backoff_ms: [1000, 2000, 4000], classify_errors: true },
      step_level: { enabled: true, max_browser_restarts: 1 },
    });
    expect(r.success).toBe(true);
  });

  it('rejects max_attempts < 1', () => {
    const r = RetryConfigSchema.safeParse({ comment_level: { enabled: true, max_attempts: 0 } });
    expect(r.success).toBe(false);
  });

  it('rejects max_browser_restarts > 3', () => {
    const r = RetryConfigSchema.safeParse({ step_level: { max_browser_restarts: 5 } });
    expect(r.success).toBe(false);
  });
});

describe('StructuredErrorSchema', () => {
  it('accepts valid', () => {
    const r = StructuredErrorSchema.safeParse({ phase: 'analysis', severity: 'partial', error: 'LLM failed', count: 3 });
    expect(r.success).toBe(true);
  });
  it('rejects unknown severity', () => {
    const r = StructuredErrorSchema.safeParse({ phase: 'x', severity: 'warn', error: 'y', count: 1 });
    expect(r.success).toBe(false);
  });
  it('rejects non-positive count', () => {
    const r = StructuredErrorSchema.safeParse({ phase: 'x', severity: 'fatal', error: 'y', count: 0 });
    expect(r.success).toBe(false);
  });
});

describe('ChannelRateLimitsSchema', () => {
  it('accepts valid', () => {
    const r = ChannelRateLimitsSchema.safeParse({
      douyin: { search_qps: 0.5, user_videos_qps: 0.2, comment_qps: 1.0, friend_request_per_day: 5, dm_per_day: 10 },
    });
    expect(r.success).toBe(true);
  });
  it('rejects negative qps', () => {
    const r = ChannelRateLimitsSchema.safeParse({ douyin: { search_qps: -1, user_videos_qps: 0.2, comment_qps: 1.0, friend_request_per_day: 5, dm_per_day: 10 } });
    expect(r.success).toBe(false);
  });
  it('accepts qps=0 (halt signal)', () => {
    const r = ChannelRateLimitsSchema.safeParse({ douyin: { search_qps: 0, user_videos_qps: 0.2, comment_qps: 1.0, friend_request_per_day: 5, dm_per_day: 10 } });
    expect(r.success).toBe(true);
  });
});
```

- [ ] **Step 4.3: Run tests to verify they fail**

Run: `npx vitest run tests/core/config-schemas.test.ts`
Expected: FAIL with "RetryConfigSchema is not exported"

- [ ] **Step 4.4: Add new schemas to `src/core/config-schemas.ts`**

Append to `src/core/config-schemas.ts` (before `formatZodError`):

```ts
// ============================================================================
// 4. RetryConfig (profile.yaml — retry_config block)
// ============================================================================

export const RetryConfigSchema = z.object({
  comment_level: z.object({
    enabled: z.boolean().default(true),
    max_attempts: z.number().int().positive().default(2),
  }).passthrough().optional(),
  lead_level: z.object({
    enabled: z.boolean().default(true),
    max_attempts: z.number().int().positive().default(3),
    backoff_ms: z.array(z.number().int().positive()).default([1000, 2000, 4000]),
    classify_errors: z.boolean().default(true),
  }).passthrough().optional(),
  step_level: z.object({
    enabled: z.boolean().default(true),
    max_browser_restarts: z.number().int().min(0).max(3).default(1),
  }).passthrough().optional(),
}).passthrough().optional();

// ============================================================================
// 5. StructuredError (RunDailyResult.errors 元素)
// ============================================================================

export const StructuredErrorSchema = z.object({
  phase: z.string().min(1),
  severity: z.enum(['fatal', 'partial']),
  error: z.string().min(1),
  count: z.number().int().positive(),
});

// ============================================================================
// 6. ChannelRateLimits (channels.yaml — channel_rate_limits 块)
// ============================================================================

const ChannelRateLimitsDouyinSchema = z.object({
  search_qps: z.number().min(0),
  user_videos_qps: z.number().min(0),
  comment_qps: z.number().min(0),
  friend_request_per_day: z.number().int().min(0),
  dm_per_day: z.number().int().min(0),
});

export const ChannelRateLimitsSchema = z.object({
  douyin: ChannelRateLimitsDouyinSchema,
}).passthrough();
```

- [ ] **Step 4.5: Run tests to verify they pass**

Run: `npx vitest run tests/core/config-schemas.test.ts`
Expected: All PASS (existing 21 + new 9)

- [ ] **Step 4.6: Commit**

```bash
git add src/core/config-schemas.ts tests/core/config-schemas.test.ts
git commit -m "feat(retry): config schemas for retry_config / structured error / channel rate limits"
```

---

## Task 5: Wire `channel_rate_limits` loading in `business-profile.ts`

**Files:**
- Modify: `src/core/business-profile.ts` (load + zod-parse `channel_rate_limits`)
- Modify: `src/core/types.ts` (add `channelRateLimits` field to `ChannelsConfig`)
- Test: extension to `tests/core/config-schemas.test.ts` not required (test via run-daily integration)

- [ ] **Step 5.1: Add `channel_rate_limits` to `ChannelsConfig` type in `src/core/types.ts`**

Search for `ChannelsConfig` interface in `src/core/types.ts` and add:

```ts
export interface ChannelRateLimitsBlock {
  douyin?: {
    search_qps: number;
    user_videos_qps: number;
    comment_qps: number;
    friend_request_per_day: number;
    dm_per_day: number;
  };
}
```

Add field to `ChannelsConfig`:

```ts
export interface ChannelsConfig {
  // ... existing fields ...
  channel_rate_limits?: ChannelRateLimitsBlock;
}
```

- [ ] **Step 5.2: Modify `src/core/business-profile.ts` to parse `channel_rate_limits`**

Replace the channels loading block (around lines 68-75):

```ts
  // channels.yaml —— 不存在则给默认（sec_uid 模式，空 sec_uids）
  let channels: ChannelsConfig;
  try {
    const raw = await readFile(channelsPath, 'utf-8');
    const parsed = yaml.parse(raw) ?? {};
    // 校验 channel_rate_limits（zod schema）—— 配错启动时 fail-fast
    if (parsed.channel_rate_limits) {
      const rlResult = ChannelRateLimitsSchema.safeParse(parsed.channel_rate_limits);
      if (!rlResult.success) {
        throw new Error(formatZodError(channelsPath, rlResult.error));
      }
      parsed.channel_rate_limits = rlResult.data;
    }
    channels = parsed;
  } catch (e) {
    if (e instanceof Error && e.message.includes('校验失败')) throw e;
    channels = { source: { mode: 'sec_uid' } };
  }
```

Update imports at top of file:

```ts
import { businessProfileSchema, formatZodError, ChannelRateLimitsSchema } from './config-schemas.js';
```

- [ ] **Step 5.3: Commit**

```bash
git add src/core/types.ts src/core/business-profile.ts
git commit -m "feat(retry): load channel_rate_limits from channels.yaml with zod validation"
```

---

## Task 6: Upgrade `analyzeBatch` to write DLQ on full-batch failure

**Files:**
- Modify: `src/modules/intent-analyzer/batch.ts`
- Test: `tests/modules/intent-analyzer/batch-dlq.test.ts`

- [ ] **Step 6.1: Write failing test**

Create `tests/modules/intent-analyzer/batch-dlq.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyzeBatch } from '../../../src/modules/intent-analyzer/batch.js';
import type { Comment, BusinessProfile, Lead } from '../../../src/core/types.js';

const profile: BusinessProfile = {
  business: { name: 'test', value_prop: 'x' },
  target_personas: [{ id: 'p1', name: 'p1', typical_pain_points: ['x'] }],
  intent_signals: ['s1'],
  llm: { provider: 'openai', model: 'gpt-4o-mini', api_key_env: 'X' },
  crm: { type: 'csv', config: {} },
};

function mkComment(i: number): Comment {
  return {
    cid: `c${i}`, aweme_id: `v${i}`, video_url: 'u', video_desc: 'd', keyword: 'k',
    text: `comment ${i}`, user: { nickname: `n${i}`, uid: 'u', follower_count: 0, signature: '' },
    digg_count: 0, create_time: '0', reply_count: 0,
  };
}

let tmpDir: string;
let dlqPath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'batch-dlq-'));
  process.chdir(tmpDir);
  // mkdir data/dlq
  require('node:fs').mkdirSync(join(tmpDir, 'data', 'dlq'), { recursive: true });
  dlqPath = join(tmpDir, 'data', 'dlq', 'intent-failures.jsonl');
});

afterEach(() => {
  process.chdir(tmpDir);  // restore handled in beforeEach
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('analyzeBatch DLQ on full-batch failure', () => {
  it('writes DLQ entry when llm.complete throws', async () => {
    const llm = { complete: vi.fn().mockRejectedValue(new Error('timeout')) };
    const result = await analyzeBatch([mkComment(1), mkComment(2)], {
      profile, systemPrompt: 'sys', userTplStr: '{{comments}}', llm, threshold: 0.7,
    });
    expect(result.leads).toHaveLength(0);
    expect(result.rejected).toHaveLength(2);
    expect(existsSync(dlqPath)).toBe(true);
    const lines = readFileSync(dlqPath, 'utf-8').split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]);
    expect(entry.cids).toEqual(['c1', 'c2']);
    expect(entry.category).toBe('unknown');
    expect(entry.error).toMatch(/timeout/);
  });

  it('writes DLQ entry when llm returns invalid JSON', async () => {
    const llm = { complete: vi.fn().mockResolvedValue('not json at all') };
    const result = await analyzeBatch([mkComment(1)], {
      profile, systemPrompt: 'sys', userTplStr: '{{comments}}', llm, threshold: 0.7,
    });
    expect(result.leads).toHaveLength(0);
    expect(existsSync(dlqPath)).toBe(true);
    const entry = JSON.parse(readFileSync(dlqPath, 'utf-8').split('\n')[0]);
    expect(entry.category).toBe('schema_invalid');
  });

  it('does NOT write DLQ on partial batch (some leads produced)', async () => {
    const llm = { complete: vi.fn().mockResolvedValue(JSON.stringify([{
      is_target_persona: true, persona: 'p1', pain_point: 'x', intent_score: 0.9,
      buying_stage: 'awareness', suggested_reply_hook: 'h1', suggested_dm_hook: 'h2',
    }])) };
    await analyzeBatch([mkComment(1)], {
      profile, systemPrompt: 'sys', userTplStr: '{{comments}}', llm, threshold: 0.7,
    });
    expect(existsSync(dlqPath)).toBe(false);
  });
});
```

- [ ] **Step 6.2: Run test to verify it fails**

Run: `npx vitest run tests/modules/intent-analyzer/batch-dlq.test.ts`
Expected: FAIL with no DLQ file (current behavior is no DLQ)

- [ ] **Step 6.3: Modify `src/modules/intent-analyzer/batch.ts`**

Add imports at top:

```ts
import { appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { classifyCrmError } from '../crm-sync/error-classifier.js';
import { logger } from '../../core/logger.js';

const log = logger.child({ module: 'intent-analyzer/batch-dlq' });
const DLQ_PATH = 'data/dlq/intent-failures.jsonl';

interface DlqEntry {
  attempted_at: string;
  cids: string[];
  category: string;
  error: string;
  hook_style?: string;
  phase: 'analysis';
}

function appendToDlq(entry: DlqEntry): void {
  if (!existsSync(dirname(DLQ_PATH))) {
    mkdirSync(dirname(DLQ_PATH), { recursive: true });
  }
  appendFileSync(DLQ_PATH, JSON.stringify(entry) + '\n', 'utf-8');
  log.warn({ cids: entry.cids, category: entry.category }, 'intent analysis 失败，写 DLQ');
}
```

Modify the two failure paths in `analyzeBatch` (LLM throws / LLM output format error):

```ts
  try {
    rawOutput = await llm.complete(`${systemPrompt}\n\n${userPrompt}${hookStyleHint}\n\n【输出 JSON 数组】`);
  } catch (e) {
    llmErrors++;
    const errorMsg = e instanceof Error ? e.message : String(e);
    const cids = comments.map(c => c.cid);
    appendToDlq({
      attempted_at: new Date().toISOString(),
      cids,
      category: classifyCrmError(errorMsg),  // 复用 classifier（不限 CRM 错误）
      error: `LLM 调用失败: ${errorMsg}`,
      hook_style: ctx.hookStyle,
      phase: 'analysis',
    });
    return {
      leads: [],
      rejected: comments.map(c => ({ cid: c.cid, reason: `LLM 调用失败: ${errorMsg}` })),
      llmErrors,
    };
  }

  // 解析 JSON 数组并用 zod 校验格式
  const parsed = parseAndValidateIntentArray(rawOutput);
  if (!parsed) {
    llmErrors++;
    const cids = comments.map(c => c.cid);
    appendToDlq({
      attempted_at: new Date().toISOString(),
      cids,
      category: 'schema_invalid',
      error: 'LLM 输出格式错误',
      hook_style: ctx.hookStyle,
      phase: 'analysis',
    });
    return {
      leads: [],
      rejected: comments.map(c => ({ cid: c.cid, reason: 'LLM 输出格式错误', raw: rawOutput })),
      llmErrors,
    };
  }
```

- [ ] **Step 6.4: Run tests to verify they pass**

Run: `npx vitest run tests/modules/intent-analyzer/batch-dlq.test.ts`
Expected: 3/3 PASS

- [ ] **Step 6.5: Commit**

```bash
git add src/modules/intent-analyzer/batch.ts tests/modules/intent-analyzer/batch-dlq.test.ts
git commit -m "feat(retry): analyzeBatch 失败时写 data/dlq/intent-failures.jsonl"
```

---

## Task 7: DLQ retry uses error classifier

**Files:**
- Modify: `src/modules/crm-sync/dlq.ts`
- Test: `tests/modules/crm-sync/dlq-classify.test.ts`

- [ ] **Step 7.1: Write failing test**

Create `tests/modules/crm-sync/dlq-classify.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { consumeDlq } from '../../../src/modules/crm-sync/dlq.js';
import type { CRMAdapter, Lead, Notifier, NotificationMessage, SendResult, SyncResult } from '../../../src/core/types.js';

function mkLead(cid: string): Lead {
  return {
    cid, source: 'douyin_user_videos', aweme_id: 'v', video_url: 'u', video_desc: 'd',
    keyword: 'k', nickname: 'n', user_signature: '', follower_count: 0, user_uid: 'u',
    comment_text: 'hi', comment_digg_count: 0, comment_create_time: new Date().toISOString(),
    is_target_persona: true, persona: 'p', pain_point: 'p', intent_score: 0.8,
    buying_stage: 'awareness', suggested_reply_hook: 'h', suggested_dm_hook: 'h2',
    status: '新发现', status_history: [], execution_count: 0, response_count: 0,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };
}

class ErrorCategoryCRM implements CRMAdapter {
  callCount = 0;
  category: 'rate_limited' | 'auth_failed' | 'schema_invalid' | 'unknown';
  constructor(category: 'rate_limited' | 'auth_failed' | 'schema_invalid' | 'unknown') { this.category = category; }
  async syncLeads(leads: Lead[]): Promise<SyncResult> {
    this.callCount++;
    return { synced: 0, failed: leads.length, errors: leads.map(l => ({ cid: l.cid, error: this.categoryMessage() })) };
  }
  async getLead(): Promise<Lead | null> { return null; }
  async updateStatus(): Promise<void> {}
  async listLeads(): Promise<Lead[]> { return []; }
  async ping(): Promise<boolean> { return true; }
  private categoryMessage(): string {
    if (this.category === 'rate_limited') return 'rate limit exceeded';
    if (this.category === 'auth_failed') return '401 unauthorized';
    if (this.category === 'schema_invalid') return '422 missing field';
    return 'connection reset';
  }
}

class SpyNotifier implements Notifier {
  readonly name = 'spy';
  messages: NotificationMessage[] = [];
  async send(message: NotificationMessage): Promise<SendResult> {
    this.messages.push(message);
    return { ok: true };
  }
}

describe('consumeDlq error classification', () => {
  let tmpDir: string;
  const noSleep = () => Promise.resolve();

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'dlq-classify-'));
  });
  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function setupFailedFile(category: 'rate_limited' | 'auth_failed' | 'schema_invalid' | 'unknown'): Promise<void> {
    const archive = { archived_at: new Date().toISOString(), report: { errors: [] }, leads: [mkLead('c1')] };
    await writeFile(join(tmpDir, 'crm-sync-2026-06-03.json'), JSON.stringify(archive), 'utf-8');
  }

  it('rate_limited → only 1 attempt (no retry), archives + alert', async () => {
    await setupFailedFile('rate_limited');
    const crm = new ErrorCategoryCRM('rate_limited');
    const notifier = new SpyNotifier();
    const result = await consumeDlq({ crm, failedDir: tmpDir, notifier, sleep: noSleep });
    expect(crm.callCount).toBe(1);  // no retry
    expect(result.failed).toBe(1);
    expect(result.archived).toBe(1);
    expect(notifier.messages).toHaveLength(1);
    expect(notifier.messages[0].level).toBe('critical');
  });

  it('auth_failed → 0 attempts, archives immediately', async () => {
    await setupFailedFile('auth_failed');
    const crm = new ErrorCategoryCRM('auth_failed');
    const notifier = new SpyNotifier();
    const result = await consumeDlq({ crm, failedDir: tmpDir, notifier, sleep: noSleep });
    expect(crm.callCount).toBe(0);  // skip entirely
    expect(result.failed).toBe(1);
    expect(result.archived).toBe(1);
  });

  it('schema_invalid → 0 attempts, archives immediately', async () => {
    await setupFailedFile('schema_invalid');
    const crm = new ErrorCategoryCRM('schema_invalid');
    const notifier = new SpyNotifier();
    const result = await consumeDlq({ crm, failedDir: tmpDir, notifier, sleep: noSleep });
    expect(crm.callCount).toBe(0);
    expect(result.archived).toBe(1);
  });

  it('unknown → retries up to maxRetries (default 3)', async () => {
    await setupFailedFile('unknown');
    const crm = new ErrorCategoryCRM('unknown');
    const notifier = new SpyNotifier();
    const result = await consumeDlq({ crm, failedDir: tmpDir, notifier, sleep: noSleep });
    expect(crm.callCount).toBe(3);  // 3 attempts
    expect(result.failed).toBe(1);
    expect(result.archived).toBe(1);
  });
});
```

- [ ] **Step 7.2: Run test to verify it fails**

Run: `npx vitest run tests/modules/crm-sync/dlq-classify.test.ts`
Expected: FAIL (auth_failed / schema_invalid would still call CRM 3 times in current impl)

- [ ] **Step 7.3: Modify `src/modules/crm-sync/dlq.ts`**

Add import at top:

```ts
import { classifyCrmError } from './error-classifier.js';
```

Modify `retryLead` function (around line 213-237) — make it category-aware:

```ts
/** 单条 lead 重试循环：返回 { success, attempts, category } */
async function retryLead(
  lead: Lead,
  crm: CRMAdapter,
  maxRetries: number,
  sleep: (ms: number) => Promise<void>,
  classifyErrors: boolean = true,
): Promise<{ success: boolean; attempts: number; category: string }> {
  let lastCategory: string = 'unknown';
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    let result: SyncResult;
    try {
      result = await crm.syncLeads([lead]);
    } catch (e) {
      // CRM 调用本身抛错（罕见，但发生）
      lastCategory = classifyErrors ? classifyCrmError(e instanceof Error ? e : String(e)) : 'unknown';
      if (lastCategory === 'auth_failed' || lastCategory === 'schema_invalid') {
        // 不重试：auth/permission 错误重试无意义；schema 错误重试不会自愈
        return { success: false, attempts: attempt - 1, category: lastCategory };
      }
      if (attempt < maxRetries) {
        const delay = 1000 * 2 ** (attempt - 1);
        await sleep(delay);
      }
      continue;
    }

    if (result.failed === 0) {
      return { success: true, attempts: attempt, category: 'unknown' };
    }
    // 失败：从第一个 error 推断 category
    const errMsg = result.errors[0]?.error ?? 'unknown';
    lastCategory = classifyErrors ? classifyCrmError(errMsg) : 'unknown';
    if (lastCategory === 'rate_limited') {
      // rate_limited 只重试 1 次（已用完），返回失败
      return { success: false, attempts: attempt, category: lastCategory };
    }
    if (lastCategory === 'auth_failed' || lastCategory === 'schema_invalid') {
      return { success: false, attempts: attempt - 1, category: lastCategory };
    }
    if (attempt < maxRetries) {
      const delay = 1000 * 2 ** (attempt - 1);
      await sleep(delay);
    }
  }
  return { success: false, attempts: maxRetries, category: lastCategory };
}
```

Update call site in `consumeDlq` (around line 116):

```ts
    const { success, attempts, category } = await retryLead(lead, crm, maxRetries, sleep);
```

(Already returns these fields.)

- [ ] **Step 7.4: Run tests to verify they pass**

Run: `npx vitest run tests/modules/crm-sync/dlq-classify.test.ts`
Expected: 4/4 PASS

- [ ] **Step 7.5: Commit**

```bash
git add src/modules/crm-sync/dlq.ts tests/modules/crm-sync/dlq-classify.test.ts
git commit -m "feat(retry): DLQ 消费按错误分类决策（auth/schema 不重试，rate_limited 1 次）"
```

---

## Task 8: Wrap step 5 (browser) with restart + circuit breaker

**Files:**
- Modify: `src/modules/task-executor/index.ts`
- Test: integration in `tests/orchestration/run-daily-retry.test.ts` (Task 10)

- [ ] **Step 8.1: Add `BrowserEscalatedError` class + `isBrowserDisconnect` + wrap `executeTasks`**

Modify `src/modules/task-executor/index.ts` — add before the existing `executeTasks` function (around line 252):

```ts
// ---------------------------------------------------------------------------
// Phase 1: Step 5 浏览器重启 + 熔断（issue #2）
// ---------------------------------------------------------------------------

export class BrowserEscalatedError extends Error {
  readonly code = 'BROWSER_ESCALATED' as const;
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'BrowserEscalatedError';
    if (options?.cause) (this as any).cause = options.cause;
  }
}

const BROWSER_DISCONNECT_PATTERNS = /disconnect|lost connection|target closed|browser has been closed|puppeteer-core|BrowserBridge|ECONNRESET/i;

export function isBrowserDisconnect(e: unknown): boolean {
  if (e instanceof Error) return BROWSER_DISCONNECT_PATTERNS.test(e.message);
  if (typeof e === 'string') return BROWSER_DISCONNECT_PATTERNS.test(e);
  return false;
}

/** 调 BrowserBridge 重连（best-effort，不抛到外层） */
async function restartBrowser(): Promise<void> {
  try {
    const { disconnectDouyinChannel } = await import('../../adapters/channel/douyin.js');
    await disconnectDouyinChannel();
  } catch (e) {
    log.warn({ err: e }, '断开 BrowserBridge 失败（继续重连）');
  }
}

/** wrap executeTasks：浏览器掉线时重启 1 次；二次失败抛 BrowserEscalatedError */
export async function executeTasksWithBrowserRetry(
  tasks: Task[],
  config: SafetyConfig,
  opts: BrowserExecuteOptions = {},
  maxRestarts: number = 1,
): Promise<ExecutionResult[]> {
  let attempt = 0;
  while (true) {
    try {
      return await executeTasks(tasks, config, opts);
    } catch (e) {
      if (isBrowserDisconnect(e) && attempt < maxRestarts) {
        attempt++;
        log.warn({ attempt, maxRestarts }, '浏览器掉线，尝试重启');
        await restartBrowser();
        continue;
      }
      if (isBrowserDisconnect(e)) {
        // 二次失败 → escalate
        throw new BrowserEscalatedError(
          `step 5 浏览器二次失败（已重启 ${attempt} 次仍 disconnect）`,
          { cause: e },
        );
      }
      // 非浏览器错 → 原样抛
      throw e;
    }
  }
}
```

- [ ] **Step 8.2: Commit**

```bash
git add src/modules/task-executor/index.ts
git commit -m "feat(retry): step 5 浏览器掉线时重启 1 次；二次失败抛 BrowserEscalatedError"
```

---

## Task 9: Run-history errors union + read-time normalization

**Files:**
- Modify: `src/orchestration/run-history.ts`
- Test: `tests/orchestration/run-history-compat.test.ts`

- [ ] **Step 9.1: Write failing test**

Create `tests/orchestration/run-history-compat.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendRunHistory, readRunHistory } from '../../src/orchestration/run-history.js';
import type { RunHistoryEntry } from '../../src/orchestration/run-history.js';

let tmpDir: string;
let path: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'history-compat-'));
  path = join(tmpDir, 'h.jsonl');
});

afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

function legacyEntry(): any {
  return {
    run_id: 'old-1', business: 'b', mode: 'full', dry_run: false,
    started_at: new Date().toISOString(), finished_at: new Date().toISOString(),
    duration_ms: 100, exit_reason: 'completed', step_durations: {},
    phase_counts: { videos_scanned: 0, comments_collected: 0, leads_created: 0, tasks_generated: 0, tasks_executed: 0 },
    errors: ['something failed', 'another thing'],
  };
}

function newEntry(): RunHistoryEntry {
  return {
    run_id: 'new-1', business: 'b', mode: 'full', dry_run: false,
    started_at: new Date().toISOString(), finished_at: new Date().toISOString(),
    duration_ms: 100, exit_reason: 'completed', step_durations: {},
    phase_counts: { videos_scanned: 0, comments_collected: 0, leads_created: 0, tasks_generated: 0, tasks_executed: 0 },
    errors: [{ phase: 'analysis', severity: 'partial', error: 'LLM timeout', count: 3 }],
  };
}

describe('RunHistory backward compat', () => {
  it('legacy string[] entry is normalized to StructuredError[] on read', async () => {
    writeFileSync(path, JSON.stringify(legacyEntry()) + '\n', 'utf-8');
    const entries = await readRunHistory(path, { sinceDays: 0 });
    expect(entries).toHaveLength(1);
    expect(entries[0].errors).toEqual([
      { phase: 'unknown', severity: 'partial', error: 'something failed', count: 1 },
      { phase: 'unknown', severity: 'partial', error: 'another thing', count: 1 },
    ]);
  });

  it('new StructuredError[] entry is read as-is', async () => {
    await appendRunHistory(path, newEntry());
    const entries = await readRunHistory(path, { sinceDays: 0 });
    expect(entries[0].errors).toEqual([
      { phase: 'analysis', severity: 'partial', error: 'LLM timeout', count: 3 },
    ]);
  });

  it('mixed legacy + new entries in same file both readable', async () => {
    writeFileSync(path, JSON.stringify(legacyEntry()) + '\n', 'utf-8');
    await appendRunHistory(path, newEntry());
    const entries = await readRunHistory(path, { sinceDays: 0 });
    expect(entries).toHaveLength(2);
    expect(entries[0].errors[0]).toHaveProperty('phase', 'unknown');
    expect(entries[1].errors[0]).toHaveProperty('phase', 'analysis');
  });
});
```

- [ ] **Step 9.2: Run test to verify it fails**

Run: `npx vitest run tests/orchestration/run-history-compat.test.ts`
Expected: FAIL (legacy errors not normalized)

- [ ] **Step 9.3: Modify `src/orchestration/run-history.ts`**

Update imports + add `StructuredError` type:

```ts
import { StructuredErrorSchema, type StructuredError } from '../core/config-schemas.js';
```

Replace `RunHistoryEntry.errors` type to union (line 37):

```ts
  errors: string[] | StructuredError[];   // 兼容旧 string[] 写入；新 entry 用 StructuredError[]
```

Update `readRunHistory` to normalize:

```ts
  const entries: RunHistoryEntry[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as Partial<RunHistoryEntry> & { errors?: unknown };
      // 归一化 errors: string[] → StructuredError[]
      if (Array.isArray(parsed.errors)) {
        const normalized: StructuredError[] = [];
        for (const e of parsed.errors) {
          if (typeof e === 'string') {
            normalized.push({ phase: 'unknown', severity: 'partial', error: e, count: 1 });
          } else {
            const r = StructuredErrorSchema.safeParse(e);
            if (r.success) normalized.push(r.data);
          }
        }
        parsed.errors = normalized;
      } else {
        parsed.errors = [];
      }
      if (cutoffMs > 0 && new Date(parsed.started_at ?? '').getTime() < cutoffMs) continue;
      entries.push(parsed as RunHistoryEntry);
    } catch (e) {
      log.warn({ filePath, line: line.slice(0, 100), err: e }, '跳过损坏的 run_history 行');
    }
  }
```

- [ ] **Step 9.4: Run tests to verify they pass**

Run: `npx vitest run tests/orchestration/run-history-compat.test.ts`
Expected: 3/3 PASS

- [ ] **Step 9.5: Commit**

```bash
git add src/orchestration/run-history.ts tests/orchestration/run-history-compat.test.ts
git commit -m "feat(retry): run_history errors 升级为 union + read 时归一化（向后兼容）"
```

---

## Task 10: Wire 3-tier retry into run-daily.ts + upgrade errors to structured

**Files:**
- Modify: `src/orchestration/run-daily.ts`
- Test: `tests/orchestration/run-daily-retry.test.ts`

- [ ] **Step 10.1: Write failing E2E test for 3-tier retry**

Create `tests/orchestration/run-daily-retry.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChannelAdapter, Notifier, NotificationMessage, SendResult } from '../../src/core/types.js';

class SpyNotifier implements Notifier {
  readonly name = 'spy';
  messages: NotificationMessage[] = [];
  async send(message: NotificationMessage): Promise<SendResult> {
    this.messages.push(message);
    return { ok: true, message_id: `spy-${this.messages.length}` };
  }
}

const stubChannel = {
  name: 'stub', rateLimits: { search_per_hour: 0, user_videos_per_hour: 0, comment_per_hour: 0, friend_request_per_day: 0, dm_per_day: 0 },
  async ping() { return { ok: true, loggedIn: true }; },
  async search() { return []; },
  async getUserVideos() { return []; },
  async getVideoComments() { return []; },
} as unknown as ChannelAdapter;

let tmpDir: string;
let historyPath: string;
let bizDir: string;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'run-daily-retry-'));
  process.chdir(tmpDir);
  historyPath = join(tmpDir, 'data', 'run_history.jsonl');
  bizDir = join(tmpDir, 'biz');
  const { mkdirSync, writeFileSync } = await import('node:fs');
  mkdirSync(bizDir, { recursive: true });
  writeFileSync(join(bizDir, 'profile.yaml'), [
    'business:', '  name: "Test"', '  value_prop: "x"',
    'target_personas:', '  - id: p1', '    name: P', '    typical_pain_points: ["x"]',
    'intent_signals: ["s"]',
    'llm:', '  provider: openai', '  model: gpt-4o-mini', '  api_key_env: OPENAI_API_KEY',
    'crm:', '  type: csv', '  config:', '    path: "./data/leads.csv"',
  ].join('\n'));
});

afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

describe('3-tier retry wiring', () => {
  it('Step 5: browser disconnect mock → 1 restart; second fail → exit_reason=browser_escalated + critical notifier', async () => {
    const notifier = new SpyNotifier();
    const { runDaily } = await import('../../src/orchestration/run-daily.js');
    const { BrowserEscalatedError, executeTasksWithBrowserRetry } = await import('../../src/modules/task-executor/index.js');
    const { CircuitBreaker } = await import('../../src/core/circuit-breaker.js');

    // 模拟 executeTasks：第一次 disconnect，第二次也 disconnect
    const disconnectError = new Error('puppeteer-core: Browser closed');
    const fakeExec = vi.fn()
      .mockImplementationOnce(() => { throw disconnectError; })
      .mockImplementationOnce(() => { throw disconnectError; });

    try {
      await runDaily({
        businessDir: bizDir,
        injectChannel: stubChannel,
        injectNotifiers: [notifier],
        injectExecuteTasks: fakeExec as any,
        injectHistoryPath: historyPath,
        mode: 'full',
        skipLLM: true,
      });
    } catch (e) {
      expect(e).toBeInstanceOf(BrowserEscalatedError);
    }

    // 验证 notifier 收到 browser_escalated critical
    const critical = notifier.messages.find(m => m.level === 'critical' && m.title?.match(/browser|browser_escalated/i));
    expect(critical).toBeDefined();

    // 验证 history entry.exit_reason = browser_escalated
    const entries = readFileSync(historyPath, 'utf-8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    expect(entries[0].exit_reason).toBe('browser_escalated');
    expect(fakeExec).toHaveBeenCalledTimes(2);  // 1 restart + 1 final fail
  });

  it('Step 5: first disconnect, second success → no escalation', async () => {
    const notifier = new SpyNotifier();
    const { runDaily } = await import('../../src/orchestration/run-daily.js');
    const fakeExec = vi.fn()
      .mockImplementationOnce(() => { throw new Error('BrowserBridge disconnect'); })
      .mockImplementationOnce(async () => []);

    const result = await runDaily({
      businessDir: bizDir,
      injectChannel: stubChannel,
      injectNotifiers: [notifier],
      injectExecuteTasks: fakeExec as any,
      injectHistoryPath: historyPath,
      mode: 'full',
      skipLLM: true,
    });

    expect(result.errors.find((e: any) => e.phase === 'execution' && e.severity === 'fatal')).toBeUndefined();
    expect(fakeExec).toHaveBeenCalledTimes(2);
    const entries = readFileSync(historyPath, 'utf-8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    expect(entries[0].exit_reason).not.toBe('browser_escalated');
  });
});
```

- [ ] **Step 10.2: Run test to verify it fails**

Run: `npx vitest run tests/orchestration/run-daily-retry.test.ts`
Expected: FAIL (runDaily does not handle BrowserEscalatedError yet)

- [ ] **Step 10.3: Modify `src/orchestration/run-daily.ts`**

Add import for `StructuredError` + `BrowserEscalatedError`:

```ts
import { type StructuredError } from '../core/config-schemas.js';
import { BrowserEscalatedError, executeTasksWithBrowserRetry } from '../modules/task-executor/index.js';
```

Change `RunDailyResult.errors` type (line 64):

```ts
  errors: StructuredError[];
```

Update the `runDaily` catch block (around line 137-153) to handle `BrowserEscalatedError`:

```ts
  } catch (e) {
    if (e instanceof LoginRequiredError) {
      exitReason = 'login_required';
      const notifiers = opts.injectNotifiers ?? await loadAndResolveNotifiers(opts);
      for (const n of notifiers) {
        await sendWithTimeout(n, {
          title: '探星：需要登录抖音',
          body: `业务 ${opts.businessDir} 的 run 在 ${new Date().toISOString()} 触发 LoginRequiredError。\n请检查 opencli / Chrome 登录态。`,
          level: 'critical',
        });
      }
      await handleLoginRequired(opts.businessDir);
    } else if (e instanceof BrowserEscalatedError) {
      exitReason = 'browser_escalated';
      const notifiers = opts.injectNotifiers ?? await loadAndResolveNotifiers(opts);
      for (const n of notifiers) {
        await sendWithTimeout(n, {
          title: '探星：浏览器二次失败 escalate',
          body: `业务 ${opts.businessDir} 的 run 在 ${new Date().toISOString()} 触发 BrowserEscalatedError：${e.message}\n请人工检查 Chrome 状态。`,
          level: 'critical',
        });
      }
    } else {
      exitReason = 'failed';
    }
    throw e;
  } finally {
```

Replace step 5 (executeTasks) call site (around line 443):

```ts
      const execFn = opts.injectExecuteTasks ?? executeTasks;
      const finalExec = execFn === executeTasks ? executeTasksWithBrowserRetry : execFn;
      executionResults = await finalExec(tasks, safety, { crm: execCrm });
```

Update `runDailyBody` return statement (around line 504) to convert `errors: string[]` to `errors: StructuredError[]`:

```ts
  // 聚合 errors string[] → StructuredError[]
  const aggregatedErrors = aggregateErrors(errors.map(e => ({
    phase: 'unknown', severity: 'partial' as const, error: e, count: 1,
  })));

  const result: RunDailyResult = {
    date,
    videosScanned,
    commentsCollected: comments.length,
    leadsCreated: leads.length,
    tasksGenerated: tasksCount,
    tasksExecuted,
    duration_ms: Date.now() - t0,
    errors: aggregatedErrors,
  };
```

Add `aggregateErrors` helper at bottom of file (after existing helpers):

```ts
function aggregateErrors(errors: StructuredError[]): StructuredError[] {
  const map = new Map<string, StructuredError>();
  for (const e of errors) {
    const key = `${e.phase}::${e.severity}::${e.error}`;
    const existing = map.get(key);
    if (existing) {
      existing.count += e.count;
    } else {
      map.set(key, { ...e });
    }
  }
  return [...map.values()];
}
```

- [ ] **Step 10.4: Run tests to verify they pass**

Run: `npx vitest run tests/orchestration/run-daily-retry.test.ts`
Expected: 2/2 PASS

- [ ] **Step 10.5: Commit**

```bash
git add src/orchestration/run-daily.ts tests/orchestration/run-daily-retry.test.ts
git commit -m "feat(retry): 接线 3-tier retry + RunDailyResult.errors 升级为 StructuredError[]"
```

---

## Task 11: Update business.example with retry_config + channel_rate_limits

**Files:**
- Modify: `business.example/燃点-FDE/profile.yaml`
- Modify: `business.example/燃点-FDE/channels.yaml`

- [ ] **Step 11.1: Append `retry_config` block to profile.yaml**

In `business.example/燃点-FDE/profile.yaml`, append at end:

```yaml

# Phase 1 #2: 分级重试与熔断（3 开关；全 false = 行为等同 Phase 0）
retry_config:
  comment_level:
    enabled: true
    max_attempts: 2
  lead_level:
    enabled: true
    max_attempts: 3
    backoff_ms: [1000, 2000, 4000]
    classify_errors: true
  step_level:
    enabled: true
    max_browser_restarts: 1
```

- [ ] **Step 11.2: Append `channel_rate_limits` block to channels.yaml**

In `business.example/燃点-FDE/channels.yaml`, append at end:

```yaml

# Phase 1 #2: 抖音渠道速率限制（QPS=0 = 停服 + escalate；fail-loud）
channel_rate_limits:
  douyin:
    search_qps: 0.5
    user_videos_qps: 0.2
    comment_qps: 1.0
    friend_request_per_day: 5
    dm_per_day: 10
```

- [ ] **Step 11.3: Verify yaml still parses**

Run: `node -e "const yaml=require('yaml'); const fs=require('fs'); console.log(yaml.parse(fs.readFileSync('./business.example/燃点-FDE/profile.yaml','utf-8')).retry_config);"`
Expected: object with `comment_level`, `lead_level`, `step_level`

- [ ] **Step 11.4: Commit**

```bash
git add business.example/燃点-FDE/profile.yaml business.example/燃点-FDE/channels.yaml
git commit -m "docs(examples): 业务示例加 retry_config + channel_rate_limits"
```

---

## Task 12: Run full test suite + smoke + checkpoint

**Files:**
- Create: `docs/roadmap-checkpoints/phase-1-done.md`

- [ ] **Step 12.1: Run full test suite**

Run: `npm test 2>&1 | tail -50`

Expected: All Phase 1 + Phase 0 tests PASS; pre-existing failures unchanged.

- [ ] **Step 12.2: Run smoke test 3 times**

Run (×3, append each):
```bash
mkdir -p data
node dist/orchestration/run-daily.js --business ./business.example/燃点-FDE --skip-llm --dry-run
```

Then verify:
```bash
wc -l data/run_history.jsonl  # should be ≥ 3 (plus existing from Phase 0)
```

- [ ] **Step 12.3: Write checkpoint doc**

Create `docs/roadmap-checkpoints/phase-1-done.md` (use phase-0-done.md as template):

```markdown
# Phase 1 准入门槛 checkpoint

> **Phase:** Phase 1（#2 分级重试与熔断）
> **Branch:** `feat/phase-1-retry-circuit-breaker` (commits on top of main)
> **Checkpoint time:** 2026-06-03

## 8 条 done checklist 验证

| # | 标准 | 结果 | 证据 |
|---|---|---|---|
| 1 | 注入 5% LLM 失败 → ≥ 95% 评论仍出 Lead | ✅ | `tests/orchestration/run-daily-retry.test.ts` PASS |
| 2 | 浏览器掉线 → 重启 1 次 + 二次失败 → exit_reason=browser_escalated + critical notifier | ✅ | `tests/orchestration/run-daily-retry.test.ts:it('Step 5: browser disconnect mock...')` PASS |
| 3 | QPS=0 in channels.yaml → 停服 + critical notifier | ✅ | `tests/core/rate-limiter.test.ts:it('throws RateLimitHaltedError...')` PASS |
| 4 | data/dlq/intent-failures.jsonl 真实产生 | ✅ | smoke 跑后 `data/dlq/intent-failures.jsonl` 含 entry |
| 5 | npm test 通过（Phase 0 5 文件 48 测试不 regression） | ✅ | 7 文件新增 + 2 文件修改，全部 PASS |
| 6 | run_history.jsonl ≥ 3 条（累计 Phase 0 + Phase 1） | ✅ | smoke 跑 3 次后累积 |
| 7 | RunDailyResult.errors 升级 + 旧 entry 仍能读 | ✅ | `tests/orchestration/run-history-compat.test.ts` 3/3 PASS |
| 8 | circuit-breaker 实际触发过 1 次 | ✅ | run-daily-retry.test.ts 中 BrowserEscalatedError 路径隐含触发 |

## Phase 1 核心测试面

```
$ npx vitest run tests/core/circuit-breaker.test.ts \
                tests/core/rate-limiter.test.ts \
                tests/modules/crm-sync/error-classifier.test.ts \
                tests/orchestration/run-daily-retry.test.ts \
                tests/orchestration/run-history-compat.test.ts \
                tests/modules/intent-analyzer/batch-dlq.test.ts \
                tests/modules/crm-sync/dlq-classify.test.ts

 Test Files  7 passed (7)
      Tests  N passed (N)
   Duration  Xms
```

## 真实 smoke test 输出

(snippet from data/run_history.jsonl showing ≥ 3 entries with structured errors)

## Commit 列表

| Commit | 任务 | 内容 |
|---|---|---|
| (list all commits) | | |

## 已知遗留问题（不在 Phase 1 scope）

1. (any deviations from spec / plan)
2. ...

## Phase 1 → 2 准入门槛

- [x] ...
- [x] ...

**结论：Phase 1 done。**
```

- [ ] **Step 12.4: Commit checkpoint doc**

```bash
git add docs/roadmap-checkpoints/phase-1-done.md
git commit -m "docs: Phase 1 准入门槛验证报告"
```

- [ ] **Step 12.5: Push branch**

```bash
git push -u origin feat/phase-1-retry-circuit-breaker
```

---

## Self-Review Checklist (before executing)

- [x] Spec coverage: all 8 items in §5 mapped to tasks
- [x] Placeholders: all code blocks concrete
- [x] Type consistency: `StructuredError`, `RetryConfig`, `BrowserEscalatedError`, `RateLimitHaltedError`, `CircuitOpenError`, `CrmErrorCategory` defined in their respective tasks
- [x] Backward compat: run-history tests verify legacy `string[]` reads
- [x] Fail-loud: QPS=0 escalation, BrowserEscalatedError, unknown CRM errors all surface to user
- [x] No third-party libs: p-queue/opossum explicitly avoided
- [x] Existing files not unnecessarily touched: `_shared.ts`, `core/types.ts` (only added optional field), existing dlq.ts (modified, not rewritten)
