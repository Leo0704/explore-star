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
