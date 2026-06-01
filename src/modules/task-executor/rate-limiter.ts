/**
 * 限速模块（§3.6.5）
 *
 * 每日限额：好友 ≤5、私信 ≤10、3-8 秒间隔
 */

import type { SafetyConfig } from './index.js';

export interface RateLimitCounters {
  friend_requests_today: number;
  dm_today: number;
  last_action_ms: number;
}

export interface RateLimiter {
  canFriendRequest(config: SafetyConfig): boolean;
  canDm(config: SafetyConfig): boolean;
  recordFriendRequest(): void;
  recordDm(): void;
  randomInterval(config: SafetyConfig): number;
  waitForInterval(config: SafetyConfig): Promise<void>;
  resetDaily(): void;
  getCounters(): Readonly<RateLimitCounters>;
}

/**
 * 创建限速器实例
 */
export function createRateLimiter(): RateLimiter {
  const counters: RateLimitCounters = {
    friend_requests_today: 0,
    dm_today: 0,
    last_action_ms: 0,
  };

  return {
    canFriendRequest(config: SafetyConfig): boolean {
      return counters.friend_requests_today < config.rate_limits.douyin.friend_request_per_day;
    },

    canDm(config: SafetyConfig): boolean {
      return counters.dm_today < config.rate_limits.douyin.dm_per_day;
    },

    recordFriendRequest(): void {
      counters.friend_requests_today++;
    },

    recordDm(): void {
      counters.dm_today++;
    },

    randomInterval(config: SafetyConfig): number {
      const { min_interval_seconds, max_interval_seconds } = config.rate_limits;
      return (
        Math.floor(Math.random() * (max_interval_seconds - min_interval_seconds + 1)) +
        min_interval_seconds
      ) * 1000;
    },

    async waitForInterval(config: SafetyConfig): Promise<void> {
      const ms = this.randomInterval(config);
      await new Promise(resolve => setTimeout(resolve, ms));
      counters.last_action_ms = Date.now();
    },

    resetDaily(): void {
      counters.friend_requests_today = 0;
      counters.dm_today = 0;
    },

    getCounters(): Readonly<RateLimitCounters> {
      return { ...counters };
    },
  };
}

/**
 * 检查是否超过每日限额
 */
export function isOverDailyLimit(
  action: 'friend_request' | 'dm',
  config: SafetyConfig,
  counters: RateLimitCounters
): boolean {
  if (action === 'friend_request') {
    return counters.friend_requests_today >= config.rate_limits.douyin.friend_request_per_day;
  }
  if (action === 'dm') {
    return counters.dm_today >= config.rate_limits.douyin.dm_per_day;
  }
  return false;
}