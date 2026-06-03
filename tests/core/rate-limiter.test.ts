/**
 * Per-channel 速率限制调度器单元测试（Phase 1 #2）
 *
 * 覆盖：
 *   - QPS > 0 时不阻塞
 *   - QPS = 0 时 throw RateLimitHaltedError + 恰好 1 次 critical notifier
 *   - 日 quota: canFriendRequest / canDm
 *   - QPS 节流：第二次调用 sleep 到下一窗口
 *   - 正常 QPS 不触发 notifier
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RateLimiter } from '../../src/core/rate-limiter.js';
import type { Notifier, NotificationMessage, SendResult, RateLimits } from '../../src/core/types.js';

class SpyNotifier implements Notifier {
  readonly name = 'spy';
  messages: NotificationMessage[] = [];
  async send(message: NotificationMessage): Promise<SendResult> {
    this.messages.push(message);
    return { ok: true };
  }
}

const noopSleep = () => Promise.resolve();
const baseAdapter: RateLimits = {
  search_per_hour: 100, user_videos_per_hour: 100, comment_per_hour: 100,
  friend_request_per_day: 100, dm_per_day: 100,
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-06-03T10:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('RateLimiter', () => {
  it('passes when QPS > 0 and first call', async () => {
    const notifier = new SpyNotifier();
    const rl = RateLimiter.fromConfig({
      channelLimits: { search_qps: 2, user_videos_qps: 1, comment_qps: 5, friend_request_per_day: 10, dm_per_day: 20 },
      adapterLimits: baseAdapter,
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
      adapterLimits: baseAdapter,
      notifier,
      sleep: noopSleep,
    });
    await expect(rl.waitForSearch()).rejects.toThrow(/Rate limit halted/);
    // 第二次也抛错（halted state 持续），但 notifier 只发 1 次
    await expect(rl.waitForSearch()).rejects.toThrow(/Rate limit halted/);
    expect(notifier.messages).toHaveLength(1);
    expect(notifier.messages[0].level).toBe('critical');
    expect(notifier.messages[0].title).toMatch(/停服|halt/i);
  });

  it('daily quota: canFriendRequest returns false when quota reached', () => {
    const notifier = new SpyNotifier();
    const rl = RateLimiter.fromConfig({
      channelLimits: { search_qps: 1, user_videos_qps: 1, comment_qps: 1, friend_request_per_day: 2, dm_per_day: 5 },
      adapterLimits: baseAdapter,
      notifier,
      sleep: noopSleep,
    });
    expect(rl.canFriendRequest()).toBe(true);
    rl.recordFriendRequest();
    expect(rl.canFriendRequest()).toBe(true);
    rl.recordFriendRequest();
    expect(rl.canFriendRequest()).toBe(false);
  });

  it('daily quota: recordDm increments; canDm respects quota', () => {
    const notifier = new SpyNotifier();
    const rl = RateLimiter.fromConfig({
      channelLimits: { search_qps: 1, user_videos_qps: 1, comment_qps: 1, friend_request_per_day: 5, dm_per_day: 1 },
      adapterLimits: baseAdapter,
      notifier,
      sleep: noopSleep,
    });
    rl.recordDm();
    expect(rl.canDm()).toBe(false);
  });

  it('QPS throttle: second call within window sleeps', async () => {
    const notifier = new SpyNotifier();
    const sleep = vi.fn(() => Promise.resolve());
    const rl = RateLimiter.fromConfig({
      channelLimits: { search_qps: 2, user_videos_qps: 1, comment_qps: 1, friend_request_per_day: 5, dm_per_day: 5 },
      adapterLimits: baseAdapter,
      notifier,
      sleep,
    });
    await rl.waitForSearch();
    // 第二次 call 在同一秒内：QPS=2 间隔 500ms，但 fake timer 在同一时刻，elapsed=0 → 需 sleep 500ms
    const p = rl.waitForSearch();
    expect(sleep).toHaveBeenCalled();
    await p;
  });

  it('does NOT escalate when QPS > 0 (only on QPS=0)', async () => {
    const notifier = new SpyNotifier();
    const rl = RateLimiter.fromConfig({
      channelLimits: { search_qps: 0.5, user_videos_qps: 0.5, comment_qps: 0.5, friend_request_per_day: 5, dm_per_day: 5 },
      adapterLimits: baseAdapter,
      notifier,
      sleep: noopSleep,
    });
    await rl.waitForSearch();
    expect(notifier.messages).toHaveLength(0);
  });

  it('throws RateLimitHaltedError when user_videos_qps=0', async () => {
    const notifier = new SpyNotifier();
    const rl = RateLimiter.fromConfig({
      channelLimits: { search_qps: 1, user_videos_qps: 0, comment_qps: 1, friend_request_per_day: 5, dm_per_day: 5 },
      adapterLimits: baseAdapter,
      notifier,
      sleep: noopSleep,
    });
    await expect(rl.waitForUserVideos()).rejects.toThrow(/Rate limit halted/);
    expect(notifier.messages.find(m => m.title?.includes('user_videos'))).toBeDefined();
  });
});
