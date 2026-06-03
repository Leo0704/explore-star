/**
 * Circuit Breaker 单元测试（Phase 1 #2）
 *
 * 覆盖：
 *  - 初始 CLOSED 状态
 *  - 失败 >= threshold → OPEN + onOpen hook
 *  - OPEN 期间 exec() throw CircuitOpenError 且不调 fn
 *  - cooldown 后 OPEN → HALF_OPEN
 *  - HALF_OPEN 成功 → CLOSED
 *  - HALF_OPEN 失败 → OPEN
 *  - CLOSED 状态下 recordSuccess 重置计数
 */

import { describe, it, expect, vi } from 'vitest';
import { CircuitBreaker } from '../../src/core/circuit-breaker.js';

describe('CircuitBreaker', () => {
  it('starts CLOSED and lets calls through', async () => {
    const cb = new CircuitBreaker({ name: 'test', failureThreshold: 3, cooldownMs: 1000 });
    expect(cb.getState()).toBe('CLOSED');
    const result = await cb.exec(async () => 'ok');
    expect(result).toBe('ok');
    expect(cb.getState()).toBe('CLOSED');
  });

  it('opens after threshold failures and throws CircuitOpenError', async () => {
    const onOpen = vi.fn();
    const cb = new CircuitBreaker({ name: 'test', failureThreshold: 2, cooldownMs: 1000, onOpen });
    const fail = async () => { throw new Error('boom'); };
    await expect(cb.exec(fail)).rejects.toThrow('boom');
    await expect(cb.exec(fail)).rejects.toThrow('boom');
    expect(cb.getState()).toBe('OPEN');
    expect(onOpen).toHaveBeenCalledWith('OPEN');
    // OPEN 期间：exec() 抛 Error，且 fn 不被调
    const calls = vi.fn(fail);
    await expect(cb.exec(calls)).rejects.toThrow('Circuit breaker "test" is OPEN');
    expect(calls).not.toHaveBeenCalled();
  });

  it('transitions OPEN → HALF_OPEN after cooldown (via injected clock)', async () => {
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

  it('recordSuccess resets failure count in CLOSED state (3rd failure alone does not open)', async () => {
    const cb = new CircuitBreaker({ name: 'test', failureThreshold: 3, cooldownMs: 1000 });
    cb.recordFailure();
    cb.recordFailure();
    cb.recordSuccess();
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe('CLOSED');  // 2 + 1 + 1 = 没超 threshold 3
  });
});
