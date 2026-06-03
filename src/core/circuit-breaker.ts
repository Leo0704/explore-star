/**
 * 3 状态熔断器（手写，无第三方依赖）
 *
 * 状态机：
 *   CLOSED ──(failures >= threshold)──→ OPEN
 *   OPEN   ──(now - opened_at >= cooldown)──→ HALF_OPEN
 *   HALF_OPEN ──(success)──→ CLOSED
 *   HALF_OPEN ──(failure)──→ OPEN
 *
 * 关键决策（spec §2.4）：
 *   - 状态仅存内存（**不**持久化）—— 重启进程 = 状态清零，对齐 fail-loud
 *   - onOpen 回调发 notifier（critical）—— 让熔断被人听见
 *   - injectClock 注入时间（测试用）
 */

import { logger } from './logger.js';

const log = logger.child({ module: 'circuit-breaker' });

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface CircuitBreakerOptions {
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

  constructor(private readonly opts: CircuitBreakerOptions) {
    this.clock = opts.injectClock ?? Date.now;
  }

  getState(): CircuitState {
    this.maybeTransitionToHalfOpen();
    return this.state;
  }

  async exec<T>(fn: () => Promise<T>): Promise<T> {
    this.maybeTransitionToHalfOpen();
    if (this.state === 'OPEN') {
      throw new Error(`Circuit breaker "${this.opts.name}" is OPEN`);
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
