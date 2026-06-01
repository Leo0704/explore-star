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
export declare function createRateLimiter(): RateLimiter;
/**
 * 检查是否超过每日限额
 */
export declare function isOverDailyLimit(action: 'friend_request' | 'dm', config: SafetyConfig, counters: RateLimitCounters): boolean;
