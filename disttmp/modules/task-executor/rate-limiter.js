/**
 * 限速模块（§3.6.5）
 *
 * 每日限额：好友 ≤5、私信 ≤10、3-8 秒间隔
 */
/**
 * 创建限速器实例
 */
export function createRateLimiter() {
    const counters = {
        friend_requests_today: 0,
        dm_today: 0,
        last_action_ms: 0,
    };
    return {
        canFriendRequest(config) {
            return counters.friend_requests_today < config.rate_limits.douyin.friend_request_per_day;
        },
        canDm(config) {
            return counters.dm_today < config.rate_limits.douyin.dm_per_day;
        },
        recordFriendRequest() {
            counters.friend_requests_today++;
        },
        recordDm() {
            counters.dm_today++;
        },
        randomInterval(config) {
            const { min_interval_seconds, max_interval_seconds } = config.rate_limits;
            return (Math.floor(Math.random() * (max_interval_seconds - min_interval_seconds + 1)) +
                min_interval_seconds) * 1000;
        },
        async waitForInterval(config) {
            const ms = this.randomInterval(config);
            await new Promise(resolve => setTimeout(resolve, ms));
            counters.last_action_ms = Date.now();
        },
        resetDaily() {
            counters.friend_requests_today = 0;
            counters.dm_today = 0;
        },
        getCounters() {
            return { ...counters };
        },
    };
}
/**
 * 检查是否超过每日限额
 */
export function isOverDailyLimit(action, config, counters) {
    if (action === 'friend_request') {
        return counters.friend_requests_today >= config.rate_limits.douyin.friend_request_per_day;
    }
    if (action === 'dm') {
        return counters.dm_today >= config.rate_limits.douyin.dm_per_day;
    }
    return false;
}
//# sourceMappingURL=rate-limiter.js.map