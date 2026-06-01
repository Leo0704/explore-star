/**
 * 安全模块（§3.6.5）
 *
 * 读取 config/safety.json + EMERGENCY_STOP 开关检测
 */
import { readFileSync, existsSync } from 'node:fs';
const DEFAULT_CONFIG_PATH = 'config/safety.json';
/**
 * 加载安全配置
 */
export function loadSafetyConfig(configPath = DEFAULT_CONFIG_PATH) {
    try {
        const raw = readFileSync(configPath, 'utf-8');
        return JSON.parse(raw);
    }
    catch {
        return getDefaultSafetyConfig();
    }
}
/**
 * 默认安全配置（fallback）
 */
export function getDefaultSafetyConfig() {
    return {
        rate_limits: {
            douyin: {
                search_calls_per_hour: 10,
                user_videos_calls_per_hour: 30,
                friend_request_per_day: 5,
                dm_per_day: 10,
            },
            min_interval_seconds: 3,
            max_interval_seconds: 8,
        },
        daily_budget: {
            videos: 50,
            comments_scanned: 5000,
            leads_created: 200,
            engagement_actions: 20,
        },
        emergency_stop: 'config/EMERGENCY_STOP',
        fatal_signals: [
            'auth_wall_detected',
            'captcha_triggered_3_times_in_1h',
            'private_msg_rejected_2_times',
            'ip_changed_5_times',
        ],
    };
}
/**
 * 检查紧急停止开关
 */
export function isEmergencyStop(config) {
    return existsSync(config.emergency_stop);
}
/**
 * 紧急停止则抛错
 */
export function throwIfEmergencyStop(config) {
    if (isEmergencyStop(config)) {
        throw new Error('紧急停止开关已启用，终止执行');
    }
}
/**
 * 检查是否为致命信号
 */
export function isFatalSignal(signalType, config) {
    return config.fatal_signals.includes(signalType);
}
const SIGNAL_ACTIONS = {
    captcha_triggered_3_times_in_1h: 'stop_today',
    private_msg_rejected_2_times: 'emergency_stop',
    ip_changed_5_times: 'emergency_stop',
    account_ban: 'emergency_stop',
    slider: 'pause_1h',
    rate_limit: 'pause_1h',
    ip_switch: 'stop_today',
};
export function createRiskSignal(type) {
    return {
        type,
        count: 1,
        action: SIGNAL_ACTIONS[type] ?? 'pause_1h',
    };
}
//# sourceMappingURL=safety.js.map